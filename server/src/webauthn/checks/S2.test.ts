import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { S2 } from './S2.js';
import type { TransferApproval, TransferContext } from './types.js';

function context(txHash: string, approval: TransferApproval | undefined): TransferContext {
  return {
    txHash,
    now: new Date('2026-01-01T00:00:00Z'),
    approval,
    consumeApproval: () => true,
  };
}

const approval = { stepupAt: '2026-01-01T00:00:00.000Z', approvedTxHash: 'approved' };

describe('S2 transfer matches the approved transaction', () => {
  it('accepts the approved transaction', () => {
    expect(() => {
      S2.run(context('approved', approval));
    }).not.toThrow();
  });

  it('rejects a different transaction', () => {
    expectRejectedBy(() => {
      S2.run(context('tampered', approval));
    }, 'S2');
  });

  it('rejects when there is no approval', () => {
    expectRejectedBy(() => {
      S2.run(context('approved', undefined));
    }, 'S2');
  });

  it('does not depend on S3 having run first', () => {
    // The approval is loaded when the context is built, not handed over by S3.
    expect(() => {
      S2.run(context('approved', approval));
    }).not.toThrow();
  });
});
