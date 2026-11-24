import { A1 } from './checks/A1.js';
import { A2 } from './checks/A2.js';
import { A3 } from './checks/A3.js';
import { A4 } from './checks/A4.js';
import { C1 } from './checks/C1.js';
import { C2 } from './checks/C2.js';
import { C3 } from './checks/C3.js';
import { C4 } from './checks/C4.js';
import { C5 } from './checks/C5.js';
import { L1 } from './checks/L1.js';
import { L2 } from './checks/L2.js';
import { L3 } from './checks/L3.js';
import { L4 } from './checks/L4.js';
import { R1 } from './checks/R1.js';
import { R2 } from './checks/R2.js';
import { R3 } from './checks/R3.js';
import { R4 } from './checks/R4.js';
import { R5 } from './checks/R5.js';
import { S1 } from './checks/S1.js';
import { S2 } from './checks/S2.js';
import { S3 } from './checks/S3.js';
import type {
  AuthenticationContext,
  Check,
  CheckId,
  RegistrationContext,
  StepupContext,
  TransferContext,
} from './checks/types.js';

/**
 * Every check a registration must pass, in order. Routes use this constant and
 * nothing else: there is no flag or environment variable that turns a check off.
 * Tests remove one check from a copy of this list to show which attack it stops.
 *
 * C4 comes first: the challenge is consumed before any other check runs and
 * before the attestation object is decoded (the context decodes it lazily), so
 * a rejected or malformed response still burns its challenge.
 */
export const REGISTRATION_CHECKS: readonly Check<RegistrationContext>[] = Object.freeze([
  C4,
  C2,
  C5,
  C1,
  C3,
  A1,
  A2,
  A3,
  R1,
  R2,
  R3,
  R4,
  R5,
]);

/**
 * Every check a login must pass, in order. Same rules as REGISTRATION_CHECKS:
 * C4 first, no way to turn a check off. L1 → L2 → L3 because L2 and L3 need the
 * stored credential; L4 and A4 after L3 because the flags and the counter mean
 * nothing until the signature is known to be genuine.
 */
export const AUTHENTICATION_CHECKS: readonly Check<AuthenticationContext>[] = Object.freeze([
  C4,
  C2,
  C5,
  C1,
  C3,
  A1,
  A2,
  A3,
  L1,
  L2,
  L3,
  L4,
  A4,
]);

/**
 * Every check a step-up re-authentication must pass (docs/01 §5.3). The login
 * list with S1 in place of L2: the user is the one logged in to the session, and
 * userHandle may be absent because allowCredentials is set. Same rules otherwise.
 */
export const STEPUP_CHECKS: readonly Check<StepupContext>[] = Object.freeze([
  C4,
  C2,
  C5,
  C1,
  C3,
  A1,
  A2,
  A3,
  L1,
  S1,
  L3,
  L4,
  A4,
]);

/**
 * Checked before a transfer moves money. S3 consumes the approval first, then S2
 * compares it, so a transfer that S2 rejects still uses the approval up.
 */
export const TRANSFER_GATE_CHECKS: readonly Check<TransferContext>[] = Object.freeze([S3, S2]);

/** Runs the frozen transfer gate. The transfer route calls this, never runChecks with a list. */
export function runTransferGate(ctx: TransferContext): void {
  runChecks(ctx, TRANSFER_GATE_CHECKS);
}

/**
 * Runs every check in order and stops at the first that throws.
 * `onResult` only observes (for the inspection, M4): it is told 'pass' after a
 * check returns and 'fail' before the error is rethrown unchanged.
 */
export function runChecks<Ctx>(
  ctx: Ctx,
  checks: readonly Check<Ctx>[],
  onResult?: (id: CheckId, result: 'pass' | 'fail') => void,
): void {
  for (const check of checks) {
    try {
      check.run(ctx);
    } catch (err) {
      onResult?.(check.id, 'fail');
      throw err;
    }
    onResult?.(check.id, 'pass');
  }
}
