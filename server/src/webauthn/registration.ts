import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { RegisterOptionsResponse, RegistrationResponse, Transport } from '@app/shared';
import type { Config } from '../config.js';
import { bytesEqual, fromBase64Url, toBase64Url } from './bytes.js';
import { consumeChallenge, findChallenge, issueChallenge } from './challenges.js';
import type { RegistrationContext } from './checks/types.js';
import { CHALLENGE_TTL_MS, INITIAL_BALANCE, RP_NAME, SUPPORTED_ALGORITHMS } from './constants.js';
import { parseCosePublicKey, type CosePublicKey } from './cose.js';
import { ParseError } from './errors.js';
import {
  parseAttestationObject,
  parseAuthenticatorData,
  parseClientDataJSON,
  type AttestedCredentialData,
  type AuthenticatorData,
} from './parse.js';

export interface RegistrationDeps {
  db: DatabaseSync;
  config: Config;
  now: () => Date;
}

/** Step 1: issue a challenge for a new user and build PublicKeyCredentialCreationOptions. */
export function createRegistrationOptions(
  deps: RegistrationDeps,
  displayName: string,
): { options: RegisterOptionsResponse; ceremonyId: string } {
  // Opaque random user handle (docs/01 §3): no personal data goes to the authenticator.
  const userHandle = randomBytes(32);
  const { id, challenge } = issueChallenge(deps.db, deps.now(), {
    purpose: 'register',
    userHandle,
    displayName,
  });
  return {
    ceremonyId: id,
    options: {
      rp: { id: deps.config.rpId, name: RP_NAME },
      user: { id: toBase64Url(userHandle), name: displayName, displayName },
      challenge: toBase64Url(challenge),
      pubKeyCredParams: SUPPORTED_ALGORITHMS.map((alg) => ({ type: 'public-key', alg })),
      timeout: CHALLENGE_TTL_MS,
      // A brand-new user has no credentials yet. Adding a second passkey (M7) fills this.
      excludeCredentials: [],
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      attestation: 'none',
    },
  };
}

interface DecodedRegistration {
  authData: AuthenticatorData;
  attested: AttestedCredentialData;
  publicKey: CosePublicKey;
}

/**
 * Decodes attestationObject and the credential public key. Throws ParseError when
 * the response is not structurally a registration response (D23): attestation
 * other than "none", no attested credential data, or a reported credential ID
 * that differs from the one inside authenticatorData.
 */
function decodeRegistration(response: RegistrationResponse): DecodedRegistration {
  const attestation = parseAttestationObject(response.response.attestationObject);
  // attestation: "none" was requested, and browsers replace any statement with "none".
  if (attestation.fmt !== 'none' || attestation.attStmt.size !== 0) {
    throw new ParseError(`unsupported attestation format: ${attestation.fmt}`);
  }
  const authData = parseAuthenticatorData(attestation.authData);
  const attested = authData.attestedCredentialData;
  if (!authData.flags.at || !attested) {
    throw new ParseError('registration response has no attested credential data');
  }
  const rawId = fromBase64Url(response.rawId, 'rawId');
  if (response.id !== response.rawId || !bytesEqual(rawId, attested.credentialId)) {
    throw new ParseError('credential ID does not match authenticatorData');
  }
  return { authData, attested, publicKey: parseCosePublicKey(attested.credentialPublicKey) };
}

/**
 * Step 2a: gather everything the checks need. Nothing here decides whether the
 * response is acceptable; that is the checks' job (pipeline.ts).
 *
 * Only clientDataJSON is decoded up front, because it carries the challenge.
 * The attestation object is decoded lazily, on the first access to authData /
 * attestedCredentialData / publicKey. C4 runs first and never touches those, so
 * the challenge is consumed before a malformed attestation can throw.
 */
export function buildRegistrationContext(
  deps: RegistrationDeps,
  input: { response: RegistrationResponse; ceremonyId: string | undefined },
): RegistrationContext {
  const clientData = parseClientDataJSON(input.response.response.clientDataJSON);
  const challengeRow = findChallenge(deps.db, clientData.challenge);
  let decoded: DecodedRegistration | undefined;
  const decode = () => (decoded ??= decodeRegistration(input.response));

  return {
    clientData,
    get authData() {
      return decode().authData;
    },
    get attestedCredentialData() {
      return decode().attested;
    },
    get publicKey() {
      return decode().publicKey;
    },
    expected: {
      type: 'webauthn.create',
      purpose: 'register',
      origin: deps.config.rpOrigin,
      rpIdHash: createHash('sha256').update(deps.config.rpId).digest(),
      algorithms: SUPPORTED_ALGORITHMS,
      now: deps.now(),
    },
    challengeRow,
    ceremonyId: input.ceremonyId,
    sessionUserId: undefined,
    sessionId: undefined,
    consumeChallenge: () => (challengeRow ? consumeChallenge(deps.db, challengeRow.id) : false),
    isCredentialRegistered: (id) =>
      deps.db.prepare('SELECT 1 FROM credentials WHERE id = ?').get(id) !== undefined,
  };
}

/** Step 2b: after every check passed, create the user and store the credential. */
export function saveRegistration(
  deps: RegistrationDeps,
  ctx: RegistrationContext,
  transports: readonly Transport[],
) {
  const row = ctx.challengeRow;
  if (!row?.userHandle || row.displayName === null) {
    // Unreachable when C2 passed: the schema requires both for register rows.
    throw new Error('registration challenge row is incomplete');
  }
  const userId = randomUUID();
  const now = deps.now().toISOString();
  const { aaguid, credentialId, credentialPublicKey } = ctx.attestedCredentialData;
  const { flags, signCount } = ctx.authData;

  deps.db.exec('BEGIN');
  try {
    deps.db
      .prepare(
        'INSERT INTO users (id, user_handle, display_name, balance, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(userId, row.userHandle, row.displayName, INITIAL_BALANCE, now);
    deps.db
      .prepare(
        `INSERT INTO credentials
           (id, user_id, public_key, sign_count, transports, backup_eligible, backup_state, aaguid, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        credentialId,
        userId,
        credentialPublicKey,
        signCount,
        JSON.stringify(transports),
        flags.be ? 1 : 0,
        flags.bs ? 1 : 0,
        formatAaguid(aaguid),
        now,
      );
    deps.db.exec('COMMIT');
  } catch (err) {
    deps.db.exec('ROLLBACK');
    throw err;
  }

  return {
    userId,
    displayName: row.displayName,
    credential: {
      id: toBase64Url(credentialId),
      alg: ctx.publicKey.alg,
      aaguid: formatAaguid(aaguid),
      signCount,
      backupEligible: flags.be,
      backupState: flags.bs,
      transports: [...transports],
    },
  };
}

function formatAaguid(aaguid: Buffer): string {
  const hex = aaguid.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
