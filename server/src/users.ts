import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './http/errors.js';

/**
 * The user's mock balance (M6). A missing user means the session outlived its
 * user (deleted in between): the client must log in again, not see a 500.
 */
export function getBalance(db: DatabaseSync, userId: string): number {
  const row = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId) as
    { balance: number } | undefined;
  if (!row) throw new HttpError(401, 'unauthenticated', 'the user no longer exists');
  return row.balance;
}
