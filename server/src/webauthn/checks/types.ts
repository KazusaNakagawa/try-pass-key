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
  | 'L3';

export class CheckError extends Error {
  constructor(
    readonly check: CheckId,
    message: string,
  ) {
    super(`${check}: ${message}`);
    this.name = 'CheckError';
  }
}

export type ChallengePurpose = 'register' | 'login' | 'stepup';

export interface ChallengeRow {
  id: string;
  challenge: Buffer;
  purpose: ChallengePurpose;
  userHandle: Buffer | null;
  displayName: string | null;
  userId: string | null;
  txHash: string | null;
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
  /** Deletes the challenge row. Returns false if it was already gone. */
  consumeChallenge(): boolean;
}

export interface RegistrationContext extends CeremonyContext {
  expected: CeremonyContext['expected'] & { algorithms: readonly number[] };
  attestedCredentialData: AttestedCredentialData;
  publicKey: CosePublicKey;
  isCredentialRegistered(credentialId: Buffer): boolean;
}

export interface Check<Ctx> {
  id: CheckId;
  /** One line: what is verified. */
  title: string;
  /** Throws CheckError when the item fails. */
  run(ctx: Ctx): void;
}
