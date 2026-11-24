import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { TransferRecord, TransferRequest } from '@app/shared';
import { inTransaction } from '../db.js';
import { HttpError } from '../http/errors.js';
import { getBalance } from '../users.js';

export interface TransferDeps {
  db: DatabaseSync;
  now: () => Date;
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
  inTransaction(db, () => {
    const debited = db
      .prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?')
      .run(transfer.amount, input.userId, transfer.amount);
    if (Number(debited.changes) === 0) {
      throw new HttpError(400, 'insufficient_funds', 'the balance is not enough for this transfer');
    }
    db.prepare(
      'INSERT INTO transfers (id, user_id, to_account, amount, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(transfer.id, input.userId, transfer.to, transfer.amount, transfer.createdAt);
  });
  return { transfer, balance: getBalance(db, input.userId) };
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
