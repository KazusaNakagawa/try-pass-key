import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ChallengePurpose, ChallengeRow } from './checks/types.js';
import { CHALLENGE_TTL_MS } from './constants.js';

interface DbChallengeRow {
  id: string;
  challenge: Uint8Array;
  purpose: ChallengePurpose;
  user_handle: Uint8Array | null;
  display_name: string | null;
  user_id: string | null;
  tx_hash: string | null;
  expires_at: string;
}

export function issueChallenge(
  db: DatabaseSync,
  now: Date,
  input: { purpose: 'register'; userHandle: Buffer; displayName: string },
): { id: string; challenge: Buffer } {
  const id = randomBytes(16).toString('base64url');
  const challenge = randomBytes(32);
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO challenges (id, challenge, purpose, user_handle, display_name, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, challenge, input.purpose, input.userHandle, input.displayName, expiresAt);
  return { id, challenge };
}

export function findChallenge(db: DatabaseSync, challenge: Buffer): ChallengeRow | undefined {
  const row = db.prepare('SELECT * FROM challenges WHERE challenge = ?').get(challenge) as
    DbChallengeRow | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    challenge: Buffer.from(row.challenge),
    purpose: row.purpose,
    userHandle: row.user_handle ? Buffer.from(row.user_handle) : null,
    displayName: row.display_name,
    userId: row.user_id,
    txHash: row.tx_hash,
    expiresAt: row.expires_at,
  };
}

/** Deletes the row. Returns false if another request already deleted it. */
export function consumeChallenge(db: DatabaseSync, id: string): boolean {
  return db.prepare('DELETE FROM challenges WHERE id = ? RETURNING id').get(id) !== undefined;
}

/**
 * Deletes expired challenges (abandoned ceremonies). Run at startup and
 * periodically (index.ts). Returns the number of rows deleted.
 */
export function deleteExpiredChallenges(db: DatabaseSync, now: Date): number {
  const result = db.prepare('DELETE FROM challenges WHERE expires_at <= ?').run(now.toISOString());
  return Number(result.changes);
}
