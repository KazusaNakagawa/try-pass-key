import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { RegisterOptionsResponse, RegistrationResponse } from '@app/shared';
import type { Config } from '../config.js';
import { bytesEqual, fromBase64Url, toBase64Url } from './bytes.js';
import { consumeChallenge, findChallenge, issueChallenge } from './challenges.js';
import type { RegistrationContext } from './checks/types.js';
import { CHALLENGE_TTL_MS, RP_NAME, SUPPORTED_ALGORITHMS } from './constants.js';
import { parseCosePublicKey } from './cose.js';
import { ParseError } from './errors.js';
import { parseAttestationObject, parseAuthenticatorData, parseClientDataJSON } from './parse.js';

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

/**
 * Step 2a: decode the response and gather everything the checks need.
 * Decoding failures throw ParseError; nothing here decides whether the response
 * is acceptable. That is the checks' job (pipeline.ts).
 */
export function buildRegistrationContext(
  deps: RegistrationDeps,
  input: { response: RegistrationResponse; ceremonyId: string | undefined },
): RegistrationContext {
  const { response } = input;
  const clientData = parseClientDataJSON(response.response.clientDataJSON);
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

  // The ID the browser reports must be the one the authenticator signed into authData.
  const rawId = fromBase64Url(response.rawId, 'rawId');
  if (response.id !== response.rawId || !bytesEqual(rawId, attested.credentialId)) {
    throw new ParseError('credential ID does not match authenticatorData');
  }

  const publicKey = parseCosePublicKey(attested.credentialPublicKey);
  const challengeRow = findChallenge(deps.db, clientData.challenge);

  return {
    clientData,
    authData,
    attestedCredentialData: attested,
    publicKey,
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
    consumeChallenge: () => (challengeRow ? consumeChallenge(deps.db, challengeRow.id) : false),
    isCredentialRegistered: (id) =>
      deps.db.prepare('SELECT 1 FROM credentials WHERE id = ?').get(id) !== undefined,
  };
}

/** Step 2b: after every check passed, create the user and store the credential. */
export function saveRegistration(
  deps: RegistrationDeps,
  ctx: RegistrationContext,
  transports: readonly string[],
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
      .run(userId, row.userHandle, row.displayName, 0, now);
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
