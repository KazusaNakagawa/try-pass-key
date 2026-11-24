import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { STEPUP_TTL_MS } from '../constants.js';
import { S3 } from './S3.js';
import type { TransferApproval, TransferContext } from './types.js';

const now = new Date('2026-01-01T00:10:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

/** `consumed` is what consumeApproval reports: false when another request used it first. */
function context(approval: TransferApproval | undefined, consumed = true): TransferContext {
  return { txHash: 'tx', now, approval, consumeApproval: () => consumed };
}

describe('S3 approval exists, is fresh and unused', () => {
  it('accepts an approval made 4:59 ago', () => {
    expect(() => {
      S3.run(context({ stepupAt: ago(STEPUP_TTL_MS - 1000), approvedTxHash: 'tx' }));
    }).not.toThrow();
  });

  it('rejects when there is no approval (never stepped up, or already used)', () => {
    expectRejectedBy(() => {
      S3.run(context(undefined));
    }, 'S3');
  });

  it('rejects when another request consumed the approval first', () => {
    expectRejectedBy(() => {
      S3.run(context({ stepupAt: ago(0), approvedTxHash: 'tx' }, false));
    }, 'S3');
  });

  it('rejects an approval exactly 5 minutes old', () => {
    expectRejectedBy(() => {
      S3.run(context({ stepupAt: ago(STEPUP_TTL_MS), approvedTxHash: 'tx' }));
    }, 'S3');
  });

  it('rejects an approval whose time cannot be read', () => {
    expectRejectedBy(() => {
      S3.run(context({ stepupAt: 'not-a-date', approvedTxHash: 'tx' }));
    }, 'S3');
  });

  it('rejects an approval dated in the future', () => {
    expectRejectedBy(() => {
      S3.run(context({ stepupAt: ago(-60_000), approvedTxHash: 'tx' }));
    }, 'S3');
  });

  it('consumes the approval even when it has expired', () => {
    let consumed = false;
    const ctx: TransferContext = {
      txHash: 'tx',
      now,
      approval: { stepupAt: ago(STEPUP_TTL_MS + 1000), approvedTxHash: 'tx' },
      consumeApproval: () => (consumed = true),
    };
    expectRejectedBy(() => {
      S3.run(ctx);
    }, 'S3');
    expect(consumed).toBe(true);
  });
});
