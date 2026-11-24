import type { Response } from 'express';
import type { CeremonyInspection } from '@app/shared';
import type { Config } from '../config.js';
import { CheckError, type CheckId } from '../webauthn/checks/types.js';
import { ParseError } from '../webauthn/errors.js';
import { inspectCeremony, type InspectInput } from '../webauthn/inspect.js';
import {
  AUTHENTICATION_CHECKS,
  OPERATION_GATE_CHECKS,
  REGISTRATION_CHECKS,
  runChecks,
  STEPUP_CHECKS,
} from '../webauthn/pipeline.js';
import type {
  AuthenticationContext,
  RegistrationContext,
  StepupContext,
} from '../webauthn/checks/types.js';

type Ceremony =
  | { ceremony: 'register'; ctx: RegistrationContext }
  | { ceremony: 'login'; ctx: AuthenticationContext }
  | { ceremony: 'stepup'; ctx: StepupContext }
  | { ceremony: 'add_credential'; ctx: RegistrationContext };

const CHECKS = {
  register: REGISTRATION_CHECKS,
  login: AUTHENTICATION_CHECKS,
  stepup: STEPUP_CHECKS,
  add_credential: REGISTRATION_CHECKS,
} as const;

/**
 * Rows of the inspection. Adding a passkey also shows the operation gate, which
 * the route runs inside `save`, after the registration checks (D44).
 */
const SHOWN_CHECKS = {
  ...CHECKS,
  add_credential: Object.freeze([...REGISTRATION_CHECKS, ...OPERATION_GATE_CHECKS]),
} as const;

/** Observes check results for the inspection; never changes what runs. */
export type CheckRecorder = (id: CheckId, result: 'pass' | 'fail') => void;

/**
 * Runs the frozen pipeline for the ceremony, then `save`, exactly as before;
 * additionally records what happened for the inspection (M4). The caller names
 * the ceremony, never a list of checks, so a route cannot pass a filtered one.
 *
 * On success it returns the inspection to put in the body; on a check or parse
 * failure it leaves it on res.locals.inspection, where the error handler picks
 * it up, and rethrows. Other errors become a 500 without a body to carry it, so
 * no inspection is built. Nothing is built unless config.inspection is on.
 */
export function runInspected<T>(
  input: Ceremony & { config: Config; res: Response; save: (record: CheckRecorder) => T },
): { saved: T; inspection: CeremonyInspection | undefined } {
  const results = new Map<CheckId, 'pass' | 'fail'>();
  const record = (id: CheckId, result: 'pass' | 'fail') => results.set(id, result);
  const inspect = (failure?: unknown) =>
    inspectCeremony({
      ceremony: input.ceremony,
      ctx: input.ctx,
      checks: SHOWN_CHECKS[input.ceremony],
      results,
      config: input.config,
      ...(failure === undefined ? {} : { failure }),
    } satisfies InspectInput);
  try {
    if (input.ceremony === 'register' || input.ceremony === 'add_credential') {
      runChecks(input.ctx, CHECKS[input.ceremony], record);
    } else if (input.ceremony === 'login') runChecks(input.ctx, CHECKS.login, record);
    else runChecks(input.ctx, CHECKS.stepup, record);
    const saved = input.save(record);
    return { saved, inspection: input.config.inspection ? inspect() : undefined };
  } catch (err) {
    if (input.config.inspection && (err instanceof CheckError || err instanceof ParseError)) {
      input.res.locals.inspection = inspect(err);
    }
    throw err;
  }
}
