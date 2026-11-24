import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** docs/01 §8 session policy */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;

export interface Session {
  /** SHA-256 of the token; the token itself is only in the cookie. */
  id: string;
  userId: string;
  displayName: string;
  authAt: string;
  stepupAt: string | null;
  expiresAt: string;
  /** The user's mock balance when the session was loaded (M6). */
  balance: number;
}

interface SessionRow {
  id: string;
  user_id: string;
  /** NULL when the user row is gone (e.g. deleted without foreign keys enabled). */
  display_name: string | null;
  /** NULL together with display_name when the user row is gone. */
  balance: number | null;
  auth_at: string;
  last_seen_at: string;
  stepup_at: string | null;
  expires_at: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** Creates a session. The token goes in the cookie; only its hash is stored. */
export function createSession(
  db: DatabaseSync,
  user: { id: string; displayName: string },
  now: Date,
): { token: string; session: Session } {
  const token = randomBytes(32).toString('base64url');
  const { balance } = db.prepare('SELECT balance FROM users WHERE id = ?').get(user.id) as {
    balance: number;
  };
  const session: Session = {
    id: hashToken(token),
    userId: user.id,
    displayName: user.displayName,
    authAt: now.toISOString(),
    stepupAt: null,
    expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS).toISOString(),
    balance,
  };
  db.prepare(
    `INSERT INTO sessions (id, user_id, auth_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(session.id, session.userId, session.authAt, session.authAt, session.expiresAt);
  return { token, session };
}

/**
 * Returns the live session for a token and extends its idle timeout.
 * Expired sessions (idle or absolute) are deleted and not returned.
 */
export function loadSession(db: DatabaseSync, token: string, now: Date): Session | undefined {
  const id = hashToken(token);
  const row = db
    .prepare(
      `SELECT s.*, u.display_name, u.balance FROM sessions s
       LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(id) as SessionRow | undefined;
  if (!row) return undefined;
  const idleExpired = new Date(row.last_seen_at).getTime() + SESSION_IDLE_MS <= now.getTime();
  const absoluteExpired = new Date(row.expires_at) <= now;
  if (idleExpired || absoluteExpired || row.display_name === null || row.balance === null) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return undefined;
  }
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now.toISOString(), id);
  return {
    id,
    userId: row.user_id,
    displayName: row.display_name,
    authAt: row.auth_at,
    stepupAt: row.stepup_at,
    expiresAt: row.expires_at,
    balance: row.balance,
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
