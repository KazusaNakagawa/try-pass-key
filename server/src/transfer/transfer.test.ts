import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../test/expect-check.js';
import { TransferHarness } from '../../test/transfer-harness.js';
import { HttpError } from '../http/errors.js';
import { runChecks, TRANSFER_GATE_CHECKS } from '../webauthn/pipeline.js';
import { executeTransfer, getBalance, listTransfers } from './transfer.js';

const TX = { to: 'test-account-1', amount: 1000 };

describe('transfer approval', () => {
  it('is consumed once', () => {
    const h = new TransferHarness();
    h.approve(TX);
    const ctx = h.context(TX);
    expect(ctx.consumeApproval()).toMatchObject({ stepupAt: h.clock.toISOString() });
    expect(h.context(TX).consumeApproval()).toBeUndefined();
  });

  it('lets only one of two concurrent transfers through the gate', () => {
    const h = new TransferHarness();
    h.approve(TX);
    // Both requests arrive before either has run the gate.
    const first = h.context(TX);
    const second = h.context(TX);
    runChecks(first, TRANSFER_GATE_CHECKS);
    expectRejectedBy(() => {
      runChecks(second, TRANSFER_GATE_CHECKS);
    }, 'S3');
  });

  it('is not usable when stepup_at is missing', () => {
    const h = new TransferHarness();
    h.db.prepare("UPDATE sessions SET approved_tx_hash = 'x', stepup_at = NULL").run();
    expect(h.context(TX).consumeApproval()).toBeUndefined();
  });
});

describe('executeTransfer', () => {
  it('moves money and records the transfer', () => {
    const h = new TransferHarness();
    const result = executeTransfer(h.deps, { userId: h.userId, tx: TX });
    expect(result.balance).toBe(99_000);
    expect(result.transfer).toMatchObject({ to: 'test-account-1', amount: 1000 });
    expect(getBalance(h.db, h.userId)).toBe(99_000);
    expect(listTransfers(h.deps, h.userId).transfers).toHaveLength(1);
  });

  it('rejects more than the balance and changes nothing', () => {
    const h = new TransferHarness();
    h.db.prepare('UPDATE users SET balance = 500').run();
    let caught: unknown;
    try {
      executeTransfer(h.deps, { userId: h.userId, tx: TX });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).code).toBe('insufficient_funds');
    expect(getBalance(h.db, h.userId)).toBe(500);
    expect(listTransfers(h.deps, h.userId).transfers).toHaveLength(0);
  });

  it('lists the newest first, at most 20', () => {
    const h = new TransferHarness();
    for (let i = 1; i <= 21; i++) {
      h.clock = new Date(h.clock.getTime() + 1000);
      executeTransfer(h.deps, { userId: h.userId, tx: { to: `test-account-${i}`, amount: 1 } });
    }
    const { balance, transfers } = listTransfers(h.deps, h.userId);
    expect(balance).toBe(100_000 - 21);
    expect(transfers).toHaveLength(20);
    expect(transfers[0]?.to).toBe('test-account-21');
  });
});
