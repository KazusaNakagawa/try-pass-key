import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { STEPUP_TTL_MS } from '../constants.js';
import { S3 } from './S3.js';
import type { TransferApproval, TransferContext } from './types.js';

const now = new Date('2026-01-01T00:10:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

function context(approval: TransferApproval | undefined): TransferContext {
  return { txHash: 'tx', now, consumeApproval: () => approval, approval: undefined };
}

describe('S3 approval exists, is fresh and unused', () => {
  it('accepts an approval made 4:59 ago and hands it to S2', () => {
    const approval = { stepupAt: ago(STEPUP_TTL_MS - 1000), approvedTxHash: 'tx' };
    const ctx = context(approval);
    expect(() => {
      S3.run(ctx);
    }).not.toThrow();
    expect(ctx.approval).toEqual(approval);
  });

  it('rejects when there is no approval (never stepped up, or already used)', () => {
    expectRejectedBy(() => {
      S3.run(context(undefined));
    }, 'S3');
  });

  it('rejects an approval exactly 5 minutes old', () => {
    expectRejectedBy(() => {
      S3.run(context({ stepupAt: ago(STEPUP_TTL_MS), approvedTxHash: 'tx' }));
    }, 'S3');
  });

  it('consumes the approval only once per run', () => {
    let calls = 0;
    const ctx: TransferContext = {
      txHash: 'tx',
      now,
      consumeApproval: () => {
        calls++;
        return { stepupAt: ago(0), approvedTxHash: 'tx' };
      },
      approval: undefined,
    };
    S3.run(ctx);
    expect(calls).toBe(1);
  });
});
