import { CheckError, type Check, type OperationGateContext } from './types.js';

/**
 * S2: the operation is the one the step-up approved: same kind and same target
 * (a transfer's recipient and amount, the passkey being deleted). Without this, a
 * transfer changed after the approval goes through, and an approval for one
 * operation pays for another.
 *
 * The approval comes from the context (loaded when it was built), not from S3,
 * so S2 works on its own. A missing approval is rejected here too, not left to
 * S3: comparing against nothing must not pass.
 */
export const S2: Check<OperationGateContext> = {
  id: 'S2',
  title: 'operation matches the approved one',
  run(ctx) {
    if (!ctx.approval) throw new CheckError('S2', 'no step-up approval to compare with');
    if (ctx.approval.approvedTxHash !== ctx.txHash) {
      throw new CheckError('S2', 'operation differs from the approved one');
    }
  },
};
