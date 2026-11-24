import type { CosePublicKey } from '../cose.js';
import type { AttestedCredentialData, AuthenticatorData, ClientData } from '../parse.js';

/** Verification items from docs/01 §6. */
export type CheckId =
  | 'C1'
  | 'C2'
  | 'C3'
  | 'C4'
  | 'C5'
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'R1'
  | 'R2'
  | 'R3'
  | 'R4'
  | 'R5'
  | 'L1'
  | 'L2'
  | 'L3'
  | 'L4'
  | 'S1'
  | 'S2'
  | 'S3';

export class CheckError extends Error {
  constructor(
    readonly check: CheckId,
    message: string,
  ) {
    super(`${check}: ${message}`);
    this.name = 'CheckError';
  }
}

export type ChallengePurpose = 'register' | 'login' | 'stepup' | 'add_credential';

export interface ChallengeRow {
  id: string;
  challenge: Buffer;
  purpose: ChallengePurpose;
  userHandle: Buffer | null;
  displayName: string | null;
  userId: string | null;
  txHash: string | null;
  /** Step-up and add_credential: the session that asked for the challenge. */
  sessionId: string | null;
  expiresAt: string;
}

/** What every ceremony (registration, login, step-up) is checked against. */
export interface CeremonyContext {
  clientData: ClientData;
  authData: AuthenticatorData;
  expected: {
    type: 'webauthn.create' | 'webauthn.get';
    purpose: ChallengePurpose;
    origin: string;
    rpIdHash: Buffer;
    now: Date;
  };
  /** Row found by the challenge value in clientDataJSON, if any. */
  challengeRow: ChallengeRow | undefined;
  /** Value of the "ceremony" cookie sent with the request, if any. */
  ceremonyId: string | undefined;
  /**
   * Ceremonies inside a logged-in session (step-up, adding a passkey): the user
   * of the session the response was submitted with (S1 for step-up).
   */
  sessionUserId: string | undefined;
  /**
   * Ceremonies inside a logged-in session: the session the response was submitted
   * with (its ID, the token hash). C5 binds their challenge to it instead of the
   * ceremony cookie (D40).
   */
  sessionId: string | undefined;
  /** Deletes the challenge row. Returns false if it was already gone. */
  consumeChallenge(): boolean;
}

export interface RegistrationContext extends CeremonyContext {
  expected: CeremonyContext['expected'] & { algorithms: readonly number[] };
  attestedCredentialData: AttestedCredentialData;
  publicKey: CosePublicKey;
  isCredentialRegistered(credentialId: Buffer): boolean;
}

/** A credential as stored at registration. */
export interface StoredCredential {
  id: Buffer;
  userId: string;
  /** COSE_Key bytes. */
  publicKey: Buffer;
  signCount: number;
  backupEligible: boolean;
  backupState: boolean;
}

export interface UserRecord {
  id: string;
  userHandle: Buffer;
  displayName: string;
}

export interface AuthenticationContext extends CeremonyContext {
  /** Credential found by the response's credential ID (L1). */
  credential: StoredCredential | undefined;
  /** userHandle returned by the authenticator (user.id from registration). */
  userHandle: Buffer | undefined;
  /** The user that userHandle names. The session is created for this user (L2). */
  userByHandle: UserRecord | undefined;
  signature: Buffer;
}

/**
 * A step-up re-authentication (docs/01 §5.3). Same as a login, except the user is
 * known before the ceremony: the one logged in to the session.
 */
export interface StepupContext extends AuthenticationContext {
  sessionUserId: string;
  sessionId: string;
}

/** A step-up approval recorded on the session. */
export interface StepupApproval {
  stepupAt: string;
  approvedTxHash: string;
}

/**
 * What the operation gate (S3, S2) checks before a step-up-protected operation
 * runs: a transfer, adding a passkey or deleting one.
 */
export interface OperationGateContext {
  /** Hash of the operation being requested (operationHash). */
  txHash: string;
  now: Date;
  /** The session's approval, read when the context was built. */
  approval: StepupApproval | undefined;
  /**
   * Takes that approval off the session, only if it is still there unchanged.
   * False when another request used it first.
   */
  consumeApproval(): boolean;
}

export interface Check<Ctx> {
  id: CheckId;
  /** One line: what is verified. */
  title: string;
  /** Throws CheckError when the item fails. */
  run(ctx: Ctx): void;
}
