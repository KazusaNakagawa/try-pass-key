import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { TransferRecord, TransferRequest } from '@app/shared';
import { inTransaction } from '../db.js';
import { HttpError } from '../http/errors.js';
import { getBalance } from '../users.js';
import type { TransferApproval, TransferContext } from '../webauthn/checks/types.js';
import { transferTxHash } from './tx-hash.js';

export interface TransferDeps {
  db: DatabaseSync;
  now: () => Date;
}

/**
 * What the transfer gate (TRANSFER_GATE_CHECKS) checks for one request. The
 * approval is read here; S3 consumes it only if it is still the value read.
 */
export function buildTransferContext(
  deps: TransferDeps,
  input: { sessionId: string; tx: TransferRequest },
): TransferContext {
  const approval = readApproval(deps.db, input.sessionId);
  return {
    txHash: transferTxHash(input.tx),
    now: deps.now(),
    approval,
    consumeApproval: () =>
      approval !== undefined && clearApproval(deps.db, input.sessionId, approval.approvedTxHash),
  };
}

function readApproval(db: DatabaseSync, sessionId: string): TransferApproval | undefined {
  const row = db
    .prepare('SELECT stepup_at, approved_tx_hash FROM sessions WHERE id = ?')
    .get(sessionId) as { stepup_at: string | null; approved_tx_hash: string | null } | undefined;
  // Without a time, S3 could not tell its age: treat it as no approval at all.
  if (!row?.approved_tx_hash || !row.stepup_at) return undefined;
  return { stepupAt: row.stepup_at, approvedTxHash: row.approved_tx_hash };
}

/**
 * Clears the approval only if it is still the value read: of two concurrent
 * transfers, only the one whose UPDATE changes the row may use it.
 * (UPDATE ... RETURNING would return the cleared NULL, not the approval.)
 */
function clearApproval(db: DatabaseSync, sessionId: string, approvedTxHash: string): boolean {
  const result = db
    .prepare('UPDATE sessions SET approved_tx_hash = NULL WHERE id = ? AND approved_tx_hash = ?')
    .run(sessionId, approvedTxHash);
  return Number(result.changes) === 1;
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
