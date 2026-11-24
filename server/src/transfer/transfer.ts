import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { TransferRecord, TransferRequest } from '@app/shared';
import { HttpError } from '../http/errors.js';
import type { TransferApproval, TransferContext } from '../webauthn/checks/types.js';
import { transferTxHash } from './tx-hash.js';

export interface TransferDeps {
  db: DatabaseSync;
  now: () => Date;
}

/** What the transfer gate (TRANSFER_GATE_CHECKS) checks for one request. */
export function buildTransferContext(
  deps: TransferDeps,
  input: { sessionId: string; tx: TransferRequest },
): TransferContext {
  return {
    txHash: transferTxHash(input.tx),
    now: deps.now(),
    approval: undefined,
    consumeApproval: () => consumeApproval(deps.db, input.sessionId),
  };
}

/**
 * Takes the approval off the session. Read, then clear only if it is still the
 * value read: of two concurrent transfers, only the one whose UPDATE changes the
 * row may use it. (UPDATE ... RETURNING would return the cleared NULL, not the
 * approval.)
 */
function consumeApproval(db: DatabaseSync, sessionId: string): TransferApproval | undefined {
  const row = db
    .prepare('SELECT stepup_at, approved_tx_hash FROM sessions WHERE id = ?')
    .get(sessionId) as { stepup_at: string | null; approved_tx_hash: string | null } | undefined;
  if (!row?.approved_tx_hash) return undefined;
  const cleared = db
    .prepare('UPDATE sessions SET approved_tx_hash = NULL WHERE id = ? AND approved_tx_hash = ?')
    .run(sessionId, row.approved_tx_hash);
  if (Number(cleared.changes) === 0) return undefined;
  // Without a time, S3 could not tell its age: treat it as no approval at all.
  if (!row.stepup_at) return undefined;
  return { stepupAt: row.stepup_at, approvedTxHash: row.approved_tx_hash };
}

/** Moves the money once the gate passed. Debit and record are one transaction. */
export function executeTransfer(
  deps: TransferDeps,
  input: { userId: string; tx: TransferRequest },
): { transfer: TransferRecord; balance: number } {
  const { db } = deps;
  const transfer: TransferRecord = {
    id: randomUUID(),
    to: input.tx.to,
    amount: input.tx.amount,
    createdAt: deps.now().toISOString(),
  };
  db.exec('BEGIN');
  try {
    const debited = db
      .prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?')
      .run(transfer.amount, input.userId, transfer.amount);
    if (Number(debited.changes) === 0) {
      throw new HttpError(400, 'insufficient_funds', 'the balance is not enough for this transfer');
    }
    db.prepare(
      'INSERT INTO transfers (id, user_id, to_account, amount, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(transfer.id, input.userId, transfer.to, transfer.amount, transfer.createdAt);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { transfer, balance: getBalance(db, input.userId) };
}

export function getBalance(db: DatabaseSync, userId: string): number {
  const row = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId) as
    { balance: number } | undefined;
  if (!row) throw new Error('user not found');
  return row.balance;
}

/** Newest first, at most 20. */
export function listTransfers(
  deps: TransferDeps,
  userId: string,
): { balance: number; transfers: TransferRecord[] } {
  const rows = deps.db
    .prepare(
      `SELECT id, to_account, amount, created_at FROM transfers WHERE user_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 20`,
    )
    .all(userId) as { id: string; to_account: string; amount: number; created_at: string }[];
  return {
    balance: getBalance(deps.db, userId),
    transfers: rows.map((r) => ({
      id: r.id,
      to: r.to_account,
      amount: r.amount,
      createdAt: r.created_at,
    })),
  };
}
