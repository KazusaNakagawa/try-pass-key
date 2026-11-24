import type { Response } from 'express';
import type { CeremonyInspection } from '@app/shared';
import type { Config } from '../config.js';
import { CheckError, type CheckId } from '../webauthn/checks/types.js';
import { ParseError } from '../webauthn/errors.js';
import { inspectCeremony, type InspectInput } from '../webauthn/inspect.js';
import {
  AUTHENTICATION_CHECKS,
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
  | { ceremony: 'stepup'; ctx: StepupContext };

const CHECKS = {
  register: REGISTRATION_CHECKS,
  login: AUTHENTICATION_CHECKS,
  stepup: STEPUP_CHECKS,
} as const;

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
  input: Ceremony & { config: Config; res: Response; save: () => T },
): { saved: T; inspection: CeremonyInspection | undefined } {
  const results = new Map<CheckId, 'pass' | 'fail'>();
  const record = (id: CheckId, result: 'pass' | 'fail') => results.set(id, result);
  const inspect = (failure?: unknown) =>
    inspectCeremony({
      ceremony: input.ceremony,
      ctx: input.ctx,
      checks: CHECKS[input.ceremony],
      results,
      config: input.config,
      ...(failure === undefined ? {} : { failure }),
    } satisfies InspectInput);
  try {
    if (input.ceremony === 'register') runChecks(input.ctx, CHECKS.register, record);
    else if (input.ceremony === 'login') runChecks(input.ctx, CHECKS.login, record);
    else runChecks(input.ctx, CHECKS.stepup, record);
    const saved = input.save();
    return { saved, inspection: input.config.inspection ? inspect() : undefined };
  } catch (err) {
    if (input.config.inspection && (err instanceof CheckError || err instanceof ParseError)) {
      input.res.locals.inspection = inspect(err);
    }
    throw err;
  }
}
