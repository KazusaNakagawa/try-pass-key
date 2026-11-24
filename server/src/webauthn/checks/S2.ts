import { CheckError, type Check, type TransferContext } from './types.js';

/**
 * S2: the transfer is the one the step-up approved (same recipient and amount).
 * Without this, a transfer changed after the approval goes through.
 *
 * The approval comes from the context (loaded when it was built), not from S3,
 * so S2 works on its own. A missing approval is rejected here too, not left to
 * S3: comparing against nothing must not pass.
 */
export const S2: Check<TransferContext> = {
  id: 'S2',
  title: 'transfer matches the approved transaction',
  run(ctx) {
    if (!ctx.approval) throw new CheckError('S2', 'no step-up approval to compare with');
    if (ctx.approval.approvedTxHash !== ctx.txHash) {
      throw new CheckError('S2', 'transfer differs from the approved transaction');
    }
  },
};
