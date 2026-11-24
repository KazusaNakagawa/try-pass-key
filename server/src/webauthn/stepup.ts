import type { AuthenticationResponse, StepupOptionsResponse } from '@app/shared';
import {
  buildAssertionContext,
  recordAssertion,
  type AuthenticationDeps,
} from './authentication.js';
import { toBase64Url } from './bytes.js';
import { issueChallenge } from './challenges.js';
import type { StepupContext } from './checks/types.js';
import { CHALLENGE_TTL_MS } from './constants.js';

/**
 * Step-up re-authentication before a transfer (docs/01 §5.3). The challenge row
 * remembers whose session asked (C5) and which transaction is being approved
 * (S2, through the session after verify). No ceremony cookie: the session binds it.
 */
export function createStepupOptions(
  deps: AuthenticationDeps,
  input: { userId: string; txHash: string },
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
  input: { response: AuthenticationResponse; sessionUserId: string },
): StepupContext {
  const ctx = buildAssertionContext(deps, input.response, {
    purpose: 'stepup',
    ceremonyId: undefined,
    sessionUserId: input.sessionUserId,
  });
  // Returned as is: spreading would read the lazy getters before C4 runs.
  return Object.assign(ctx, { sessionUserId: input.sessionUserId });
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
