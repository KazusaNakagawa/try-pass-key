import type {
  CredentialSummary,
  RegisterOptionsResponse,
  RegistrationResponse,
  Transport,
} from '@app/shared';
import { credentialDescriptors } from '../credentials/credentials.js';
import { toBase64Url } from './bytes.js';
import { issueChallenge } from './challenges.js';
import type { RegistrationContext } from './checks/types.js';
import {
  buildCreationContext,
  creationOptions,
  formatAaguid,
  insertCredential,
  type RegistrationDeps,
} from './registration.js';

/**
 * Adding a passkey to the logged-in user's account (docs/01 §5.4). Checked by
 * REGISTRATION_CHECKS like a new account, with purpose add_credential: the
 * challenge row names the user and the session that asked (C5 binds it to the
 * session, no ceremony cookie). The step-up approval is checked by the operation
 * gate in the route, after these checks and before saving.
 */
export function createAddCredentialOptions(
  deps: RegistrationDeps,
  input: { userId: string; sessionId: string; timeoutMs?: number },
): RegisterOptionsResponse {
  const user = deps.db
    .prepare('SELECT user_handle, display_name FROM users WHERE id = ?')
    .get(input.userId) as { user_handle: Uint8Array; display_name: string } | undefined;
  if (!user) throw new Error('session user does not exist');
  const { challenge } = issueChallenge(deps.db, deps.now(), {
    purpose: 'add_credential',
    userId: input.userId,
    sessionId: input.sessionId,
  });
  return creationOptions(deps, {
    challenge,
    // The same user.id, so the new passkey logs in to this account (L2).
    userHandle: Buffer.from(user.user_handle),
    displayName: user.display_name,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    // An authenticator that already holds one of them refuses (InvalidStateError)
    // instead of creating a second passkey, or overwriting the first, for this user.
    excludeCredentials: credentialDescriptors(deps.db, input.userId),
  });
}

export function buildAddCredentialContext(
  deps: RegistrationDeps,
  input: { response: RegistrationResponse; sessionUserId: string; sessionId: string },
): RegistrationContext {
  return buildCreationContext(deps, input.response, {
    purpose: 'add_credential',
    ceremonyId: undefined,
    sessionUserId: input.sessionUserId,
    sessionId: input.sessionId,
  });
}

/**
 * After every check (and the gate) passed: stores the credential for the user the
 * challenge row names, not the session's. The two are the same whenever C5
 * passed; starting from the row is what lets the C5 attack be reproduced.
 */
export function saveAddedCredential(
  deps: RegistrationDeps,
  ctx: RegistrationContext,
  transports: readonly Transport[],
): { userId: string; credential: CredentialSummary } {
  const userId = ctx.challengeRow?.userId;
  if (!userId) {
    // Unreachable when C2 passed: the schema requires user_id on add_credential rows.
    throw new Error('add_credential challenge row has no user');
  }
  const now = deps.now().toISOString();
  insertCredential(deps.db, { userId, ctx, transports, now });
  const { flags } = ctx.authData;
  return {
    userId,
    credential: {
      id: toBase64Url(ctx.attestedCredentialData.credentialId),
      createdAt: now,
      lastUsedAt: null,
      backupEligible: flags.be,
      backupState: flags.bs,
      aaguid: formatAaguid(ctx.attestedCredentialData.aaguid),
      transports: [...transports],
    },
  };
}
