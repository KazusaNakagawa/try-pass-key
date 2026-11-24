import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthenticationResponse, LoginOptionsResponse } from '@app/shared';
import { fromBase64Url, toBase64Url } from './bytes.js';
import { consumeChallenge, findChallenge, issueChallenge } from './challenges.js';
import {
  CheckError,
  type AuthenticationContext,
  type StoredCredential,
  type UserRecord,
} from './checks/types.js';
import { CHALLENGE_TTL_MS } from './constants.js';
import { ParseError } from './errors.js';
import { parseAuthenticatorData, parseClientDataJSON, type AuthenticatorData } from './parse.js';
import type { RegistrationDeps } from './registration.js';

export type AuthenticationDeps = RegistrationDeps;

/** Step 1: issue a login challenge. No user is known yet (username-less login). */
export function createLoginOptions(deps: AuthenticationDeps): {
  options: LoginOptionsResponse;
  ceremonyId: string;
} {
  const { id, challenge } = issueChallenge(deps.db, deps.now(), { purpose: 'login' });
  return {
    ceremonyId: id,
    options: {
      challenge: toBase64Url(challenge),
      rpId: deps.config.rpId,
      timeout: CHALLENGE_TTL_MS,
      userVerification: 'required',
      allowCredentials: [],
    },
  };
}

interface DecodedAuthentication {
  authData: AuthenticatorData;
  signature: Buffer;
  credential: StoredCredential | undefined;
  userHandle: Buffer | undefined;
  userByHandle: UserRecord | undefined;
}

/**
 * Step 2a: gather everything the checks need. Only clientDataJSON (which carries
 * the challenge) is decoded up front; the rest is decoded on first access so C4
 * consumes the challenge before anything else can throw (D24).
 */
export function buildAuthenticationContext(
  deps: AuthenticationDeps,
  input: { response: AuthenticationResponse; ceremonyId: string | undefined },
): AuthenticationContext {
  return buildAssertionContext(deps, input.response, {
    purpose: 'login',
    ceremonyId: input.ceremonyId,
    sessionUserId: undefined,
  });
}

/**
 * Shared by login and step-up (stepup.ts): both verify an assertion. The purpose
 * decides which challenge rows C2 accepts and how C5 binds the challenge.
 */
export function buildAssertionContext(
  deps: AuthenticationDeps,
  response: AuthenticationResponse,
  binding:
    | { purpose: 'login'; ceremonyId: string | undefined; sessionUserId: undefined }
    | { purpose: 'stepup'; ceremonyId: undefined; sessionUserId: string },
): AuthenticationContext {
  const clientData = parseClientDataJSON(response.response.clientDataJSON);
  const challengeRow = findChallenge(deps.db, clientData.challenge);
  let decoded: DecodedAuthentication | undefined;
  const decode = () => (decoded ??= decodeAuthentication(deps.db, response));

  return {
    clientData,
    get authData() {
      return decode().authData;
    },
    get signature() {
      return decode().signature;
    },
    get credential() {
      return decode().credential;
    },
    get userHandle() {
      return decode().userHandle;
    },
    get userByHandle() {
      return decode().userByHandle;
    },
    expected: {
      type: 'webauthn.get',
      purpose: binding.purpose,
      origin: deps.config.rpOrigin,
      rpIdHash: createHash('sha256').update(deps.config.rpId).digest(),
      now: deps.now(),
    },
    challengeRow,
    ceremonyId: binding.ceremonyId,
    sessionUserId: binding.sessionUserId,
    consumeChallenge: () => (challengeRow ? consumeChallenge(deps.db, challengeRow.id) : false),
  };
}

function decodeAuthentication(
  db: DatabaseSync,
  response: AuthenticationResponse,
): DecodedAuthentication {
  if (response.id !== response.rawId) throw new ParseError('id and rawId differ');
  const authData = parseAuthenticatorData(
    fromBase64Url(response.response.authenticatorData, 'authenticatorData'),
  );
  const userHandle =
    response.response.userHandle === undefined
      ? undefined
      : fromBase64Url(response.response.userHandle, 'userHandle');
  return {
    authData,
    signature: fromBase64Url(response.response.signature, 'signature'),
    credential: findCredential(db, fromBase64Url(response.rawId, 'rawId')),
    userHandle,
    userByHandle: userHandle ? findUserByHandle(db, userHandle) : undefined,
  };
}

function findCredential(db: DatabaseSync, id: Buffer): StoredCredential | undefined {
  const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as
    | {
        id: Uint8Array;
        user_id: string;
        public_key: Uint8Array;
        sign_count: number;
        backup_eligible: number;
        backup_state: number;
      }
    | undefined;
  if (!row) return undefined;
  return {
    id: Buffer.from(row.id),
    userId: row.user_id,
    publicKey: Buffer.from(row.public_key),
    signCount: row.sign_count,
    backupEligible: row.backup_eligible === 1,
    backupState: row.backup_state === 1,
  };
}

export function findUserByHandle(db: DatabaseSync, userHandle: Buffer): UserRecord | undefined {
  const row = db
    .prepare('SELECT id, user_handle, display_name FROM users WHERE user_handle = ?')
    .get(userHandle) as { id: string; user_handle: Uint8Array; display_name: string } | undefined;
  return row
    ? { id: row.id, userHandle: Buffer.from(row.user_handle), displayName: row.display_name }
    : undefined;
}

/**
 * Step 2b: after every check passed, record the new counter and backup state.
 * Returns the user to log in: the one userHandle names (L2 guarantees the
 * credential is theirs).
 */
export function saveAuthentication(deps: AuthenticationDeps, ctx: AuthenticationContext) {
  const user = ctx.userByHandle;
  if (!user || !ctx.credential) {
    // Unreachable when L1 and L2 passed.
    throw new Error('authentication context is incomplete');
  }
  return { user, credential: recordAssertion(deps, ctx) };
}

/**
 * Stores the counter and backup state of a verified assertion (login or step-up).
 *
 * A4 compared against the counter read when the context was built. Re-check it
 * in the UPDATE itself: two assertions with the same key (original and clone)
 * can both pass A4, and only the first may record its counter.
 */
export function recordAssertion(
  deps: AuthenticationDeps,
  ctx: AuthenticationContext,
): { id: string; signCount: number; backupState: boolean } {
  const credential = ctx.credential;
  if (!credential) throw new Error('authentication context has no credential');
  const { signCount, flags } = ctx.authData;
  const result = deps.db
    .prepare(
      `UPDATE credentials SET sign_count = ?, backup_state = ?, last_used_at = ?
       WHERE id = ? AND (sign_count < ? OR (sign_count = 0 AND ? = 0))`,
    )
    .run(
      signCount,
      flags.bs ? 1 : 0,
      deps.now().toISOString(),
      credential.id,
      signCount,
      signCount,
    );
  if (Number(result.changes) === 0) {
    throw new CheckError('A4', 'signCount was updated by a concurrent login');
  }
  return { id: toBase64Url(credential.id), signCount, backupState: flags.bs };
}
