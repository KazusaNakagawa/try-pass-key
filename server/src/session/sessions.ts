import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** docs/01 §8 session policy */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;

export interface Session {
  /** SHA-256 of the token; the token itself is only in the cookie. */
  id: string;
  userId: string;
  authAt: string;
  stepupAt: string | null;
  expiresAt: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  auth_at: string;
  last_seen_at: string;
  stepup_at: string | null;
  expires_at: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** Creates a session and returns the token to put in the cookie. */
export function createSession(db: DatabaseSync, userId: string, now: Date): string {
  const token = randomBytes(32).toString('base64url');
  const at = now.toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, auth_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    hashToken(token),
    userId,
    at,
    at,
    new Date(now.getTime() + SESSION_ABSOLUTE_MS).toISOString(),
  );
  return token;
}

/**
 * Returns the live session for a token and extends its idle timeout.
 * Expired sessions (idle or absolute) are deleted and not returned.
 */
export function loadSession(db: DatabaseSync, token: string, now: Date): Session | undefined {
  const id = hashToken(token);
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!row) return undefined;
  const idleExpired = new Date(row.last_seen_at).getTime() + SESSION_IDLE_MS <= now.getTime();
  const absoluteExpired = new Date(row.expires_at) <= now;
  if (idleExpired || absoluteExpired) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return undefined;
  }
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now.toISOString(), id);
  return {
    id,
    userId: row.user_id,
    authAt: row.auth_at,
    stepupAt: row.stepup_at,
    expiresAt: row.expires_at,
  };
}

export function destroySession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

/** Deletes sessions past their absolute or idle timeout. Returns the number deleted. */
export function deleteExpiredSessions(db: DatabaseSync, now: Date): number {
  const result = db
    .prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?')
    .run(now.toISOString(), new Date(now.getTime() - SESSION_IDLE_MS).toISOString());
  return Number(result.changes);
}
