import type { AuthenticationResponse, StepupOptionsResponse } from '@app/shared';
import {
  buildAssertionContext,
  recordAssertion,
  type AuthenticationDeps,
} from './authentication.js';
import { inTransaction } from '../db.js';
import { HttpError } from '../http/errors.js';
import { rotateSession, type Session } from '../session/sessions.js';
import { toBase64Url } from './bytes.js';
import { issueChallenge } from './challenges.js';
import type { StepupContext } from './checks/types.js';
import { CHALLENGE_TTL_MS } from './constants.js';

/**
 * Step-up re-authentication before a transfer (docs/01 §5.3). The challenge row
 * remembers which session asked (C5, D40) and which transaction is being approved
 * (S2, through the session after verify). No ceremony cookie: the session binds it.
 */
export function createStepupOptions(
  deps: AuthenticationDeps,
  input: { userId: string; sessionId: string; txHash: string },
): StepupOptionsResponse {
  const { challenge } = issueChallenge(deps.db, deps.now(), { purpose: 'stepup', ...input });
  const rows = deps.db
    .prepare('SELECT id, transports FROM credentials WHERE user_id = ? ORDER BY created_at')
    .all(input.userId) as { id: Uint8Array; transports: string }[];
  return {
    challenge: toBase64Url(challenge),
    rpId: deps.config.rpId,
    timeout: CHALLENGE_TTL_MS,
    userVerification: 'required',
    // Only asks the browser to offer these; S1 is what enforces it.
    allowCredentials: rows.map((row) => ({
      type: 'public-key' as const,
      id: toBase64Url(Buffer.from(row.id)),
      transports: JSON.parse(row.transports) as string[],
    })),
  };
}

export function buildStepupContext(
  deps: AuthenticationDeps,
  input: { response: AuthenticationResponse; sessionUserId: string; sessionId: string },
): StepupContext {
  // buildAssertionContext sets both session fields for purpose 'stepup'. Narrowed
  // by assertion rather than copied: spreading would read the lazy getters
  // before C4 runs.
  return buildAssertionContext(deps, input.response, {
    purpose: 'stepup',
    ceremonyId: undefined,
    sessionUserId: input.sessionUserId,
    sessionId: input.sessionId,
  }) as StepupContext;
}

/**
 * After every check passed: records the counter like a login and returns the
 * transaction the challenge row was issued for, to put on the session.
 */
export function saveStepup(
  deps: AuthenticationDeps,
  ctx: StepupContext,
): { credential: { id: string; signCount: number; backupState: boolean }; txHash: string } {
  const txHash = ctx.challengeRow?.txHash;
  if (!txHash) {
    // Unreachable when C2 passed: the schema requires tx_hash on step-up rows.
    throw new Error('step-up challenge has no transaction');
  }
  return { credential: recordAssertion(deps, ctx), txHash };
}

/**
 * After every check passed: records the counter and moves the session to a new
 * ID carrying the approval (docs/01 §8). Answers 401 if the session is gone.
 * One transaction: if the session cannot be moved, the counter is not recorded
 * either, so a failure never leaves a used signature without an approval.
 */
export function approveStepup(
  deps: AuthenticationDeps,
  ctx: StepupContext,
  oldToken: string,
): {
  credential: { id: string; signCount: number; backupState: boolean };
  token: string;
  session: Session;
} {
  return inTransaction(deps.db, () => {
    const { credential, txHash } = saveStepup(deps, ctx);
    const rotated = rotateSession(deps.db, oldToken, deps.now(), { txHash });
    if (!rotated) throw new HttpError(401, 'unauthenticated', 'login required');
    return { credential, ...rotated };
  });
}
