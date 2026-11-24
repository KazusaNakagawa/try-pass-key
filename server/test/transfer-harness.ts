import type { DatabaseSync } from 'node:sqlite';
import type { TransferRequest } from '@app/shared';
import { openDb } from '../src/db.js';
import { createSession, rotateSession } from '../src/session/sessions.js';
import { buildTransferContext } from '../src/transfer/transfer.js';
import { transferTxHash } from '../src/transfer/tx-hash.js';
import type { TransferContext } from '../src/webauthn/checks/types.js';
import { INITIAL_BALANCE } from '../src/webauthn/constants.js';

/** One user with one session; approvals are recorded the way a step-up does. */
export class TransferHarness {
  readonly db: DatabaseSync = openDb(':memory:');
  clock = new Date('2026-01-01T00:00:00Z');
  readonly deps = { db: this.db, now: () => this.clock };
  readonly userId = 'u1';
  private token: string;

  constructor() {
    this.db
      .prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)')
      .run(this.userId, Buffer.from([1]), 'test-user-1', INITIAL_BALANCE, this.clock.toISOString());
    this.token = createSession(
      this.db,
      { id: this.userId, displayName: 'test-user-1' },
      this.clock,
    ).token;
  }

  get sessionId(): string {
    const row = this.db.prepare('SELECT id FROM sessions').get() as { id: string };
    return row.id;
  }

  /** Records a step-up approval for `tx` at the current clock (rotates the session). */
  approve(tx: TransferRequest): void {
    const rotated = rotateSession(this.db, this.token, this.clock, { txHash: transferTxHash(tx) });
    if (!rotated) throw new Error('session is gone');
    this.token = rotated.token;
  }

  /** The production context. */
  context(tx: TransferRequest): TransferContext {
    return buildTransferContext(this.deps, { sessionId: this.sessionId, tx });
  }

  /**
   * The production context with the session's approval already read (not
   * consumed) into `approval`, so S2 still has something to compare once S3 is
   * removed. With S3 present, S3 overwrites it with what it consumed.
   */
  gateContext(tx: TransferRequest): TransferContext {
    const ctx = this.context(tx);
    const row = this.db
      .prepare('SELECT stepup_at, approved_tx_hash FROM sessions WHERE id = ?')
      .get(this.sessionId) as { stepup_at: string | null; approved_tx_hash: string | null };
    if (row.stepup_at && row.approved_tx_hash) {
      ctx.approval = { stepupAt: row.stepup_at, approvedTxHash: row.approved_tx_hash };
    }
    return ctx;
  }
}
