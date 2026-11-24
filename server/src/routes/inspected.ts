import type { Response } from 'express';
import type { CeremonyInspection } from '@app/shared';
import type { Config } from '../config.js';
import type { Check, CheckId } from '../webauthn/checks/types.js';
import { inspectCeremony, type InspectInput } from '../webauthn/inspect.js';
import { runChecks } from '../webauthn/pipeline.js';

/**
 * Runs the checks, then `save`, exactly as before; additionally records what
 * happened for the inspection (M4). On success it returns the inspection to put
 * in the body; on failure it leaves it on res.locals.inspection, where the error
 * handler picks it up, and rethrows. In production
 * no inspection is built.
 */
export function runInspected<Ctx extends InspectInput['ctx'], T>(input: {
  ceremony: InspectInput['ceremony'];
  ctx: Ctx;
  checks: readonly Check<Ctx>[];
  config: Config;
  res: Response;
  save: () => T;
}): { saved: T; inspection: CeremonyInspection | undefined } {
  const results = new Map<CheckId, 'pass' | 'fail'>();
  const enabled = input.config.nodeEnv !== 'production';
  const inspect = (failure?: unknown) =>
    inspectCeremony({ ...input, results, ...(failure === undefined ? {} : { failure }) });
  try {
    runChecks(input.ctx, input.checks, (id, result) => results.set(id, result));
    const saved = input.save();
    return { saved, inspection: enabled ? inspect() : undefined };
  } catch (err) {
    if (enabled) input.res.locals.inspection = inspect(err);
    throw err;
  }
}
