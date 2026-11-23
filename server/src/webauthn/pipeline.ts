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
import type { AuthenticationContext, Check, RegistrationContext } from './checks/types.js';

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

export function runChecks<Ctx>(ctx: Ctx, checks: readonly Check<Ctx>[]): void {
  for (const check of checks) {
    check.run(ctx);
  }
}
