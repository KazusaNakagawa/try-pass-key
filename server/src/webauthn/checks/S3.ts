import { STEPUP_TTL_MS } from '../constants.js';
import { CheckError, type Check, type TransferContext } from './types.js';

/**
 * S3: there is a step-up approval, it is at most 5 minutes old, and this transfer
 * is the one that uses it up.
 *
 * Runs first in the transfer gate and consumes the approval before anything else
 * is compared (like C4), so even a transfer S2 then rejects burns it. Without
 * this, one approval pays for any number of transfers, at any later time.
 */
export const S3: Check<TransferContext> = {
  id: 'S3',
  title: 'step-up approval exists, is fresh, and is used once',
  run(ctx) {
    ctx.approval = ctx.consumeApproval();
    if (!ctx.approval) {
      throw new CheckError('S3', 'no step-up approval (never approved, or already used)');
    }
    // Written so that an unreadable time (NaN) fails every comparison and is rejected.
    const age = ctx.now.getTime() - Date.parse(ctx.approval.stepupAt);
    if (!(age >= 0 && age < STEPUP_TTL_MS)) {
      throw new CheckError('S3', 'step-up approval has expired or has no valid time');
    }
  },
};
