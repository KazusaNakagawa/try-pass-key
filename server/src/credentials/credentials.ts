import type { DatabaseSync } from 'node:sqlite';
import type { CredentialSummary, Transport } from '@app/shared';
import { toBase64Url } from '../webauthn/bytes.js';

interface CredentialRow {
  id: Uint8Array;
  created_at: string;
  last_used_at: string | null;
  backup_eligible: number;
  backup_state: number;
  aaguid: string;
  transports: string;
}

/** The user's passkeys, oldest first (docs/01 §5.4). */
export function listCredentials(db: DatabaseSync, userId: string): CredentialSummary[] {
  const rows = db
    .prepare(
      `SELECT id, created_at, last_used_at, backup_eligible, backup_state, aaguid, transports
       FROM credentials WHERE user_id = ? ORDER BY created_at, rowid`,
    )
    .all(userId) as unknown as CredentialRow[];
  return rows.map((row) => ({
    id: toBase64Url(Buffer.from(row.id)),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    backupEligible: row.backup_eligible === 1,
    backupState: row.backup_state === 1,
    aaguid: row.aaguid,
    transports: JSON.parse(row.transports) as Transport[],
  }));
}

export function isCredentialOwnedBy(
  db: DatabaseSync,
  userId: string,
  credentialId: Buffer,
): boolean {
  return (
    db
      .prepare('SELECT 1 FROM credentials WHERE id = ? AND user_id = ?')
      .get(credentialId, userId) !== undefined
  );
}

export function countCredentials(db: DatabaseSync, userId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?').get(userId) as {
    n: number;
  };
  return row.n;
}

/**
 * Deletes the user's passkey unless it is their last one, in one statement, so
 * two concurrent deletions cannot leave the account with none. True if deleted.
 */
export function deleteCredentialUnlessLast(
  db: DatabaseSync,
  userId: string,
  credentialId: Buffer,
): boolean {
  const result = db
    .prepare(
      `DELETE FROM credentials WHERE id = ? AND user_id = ?
         AND (SELECT COUNT(*) FROM credentials WHERE user_id = ?) > 1`,
    )
    .run(credentialId, userId, userId);
  return Number(result.changes) === 1;
}
