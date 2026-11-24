import { STEPUP_TTL_MS } from '../constants.js';
import { CheckError, type Check, type OperationGateContext } from './types.js';

/**
 * S3: there is a step-up approval, it is at most 5 minutes old, and this request
 * is the one that uses it up.
 *
 * Runs first in the operation gate and consumes the approval before anything else
 * is compared (like C4), so even a request S2 then rejects burns it. Without
 * this, one approval pays for any number of operations, at any later time.
 */
export const S3: Check<OperationGateContext> = {
  id: 'S3',
  title: 'step-up approval exists, is fresh, and is used once',
  run(ctx) {
    const { approval } = ctx;
    if (!approval) {
      throw new CheckError('S3', 'no step-up approval (never approved, or already used)');
    }
    if (!ctx.consumeApproval()) {
      throw new CheckError('S3', 'step-up approval was used by another request');
    }
    // Written so that an unreadable time (NaN) fails every comparison and is rejected.
    const age = ctx.now.getTime() - Date.parse(approval.stepupAt);
    if (!(age >= 0 && age < STEPUP_TTL_MS)) {
      throw new CheckError('S3', 'step-up approval has expired or has no valid time');
    }
  },
};
