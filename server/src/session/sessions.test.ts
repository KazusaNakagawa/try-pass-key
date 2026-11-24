import { describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import {
  createSession,
  deleteExpiredSessions,
  destroySession,
  loadSession,
  rotateSession,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from './sessions.js';

function setup() {
  const db = openDb(':memory:');
  db.exec("INSERT INTO users VALUES ('u1', x'01', 'test-user-1', 0, '2026-01-01T00:00:00Z')");
  return { db, t0: new Date('2026-01-01T00:00:00Z') };
}
const after = (t: Date, ms: number) => new Date(t.getTime() + ms);
const USER = { id: 'u1', displayName: 'test-user-1' };

describe('sessions', () => {
  it('stores only the SHA-256 of the token', () => {
    const { db, t0 } = setup();
    const { token } = createSession(db, USER, t0);
    const ids = db.prepare('SELECT id FROM sessions').all() as { id: string }[];
    expect(ids).toHaveLength(1);
    expect(ids[0]?.id).not.toBe(token);
    expect(loadSession(db, token, t0)?.userId).toBe('u1');
  });

  it('expires after 30 minutes idle', () => {
    const { db, t0 } = setup();
    const { token } = createSession(db, USER, t0);
    expect(loadSession(db, token, after(t0, SESSION_IDLE_MS - 1000))).toBeDefined();
    // Each access extends the idle timeout: still alive just under 30 minutes after the last one.
    expect(loadSession(db, token, after(t0, 2 * SESSION_IDLE_MS - 2000))).toBeDefined();
    expect(loadSession(db, token, after(t0, 3 * SESSION_IDLE_MS))).toBeUndefined();
  });

  it('expires after 8 hours even when active', () => {
    const { db, t0 } = setup();
    const { token } = createSession(db, USER, t0);
    for (let t = 0; t < SESSION_ABSOLUTE_MS; t += SESSION_IDLE_MS / 2) {
      expect(loadSession(db, token, after(t0, t))).toBeDefined();
    }
    expect(loadSession(db, token, after(t0, SESSION_ABSOLUTE_MS))).toBeUndefined();
  });

  it('is gone after destroy', () => {
    const { db, t0 } = setup();
    const { token } = createSession(db, USER, t0);
    destroySession(db, token);
    expect(loadSession(db, token, t0)).toBeUndefined();
  });

  it('cleans up expired sessions', () => {
    const { db, t0 } = setup();
    createSession(db, USER, t0);
    createSession(db, USER, after(t0, SESSION_IDLE_MS));
    expect(deleteExpiredSessions(db, after(t0, SESSION_IDLE_MS + 1000))).toBe(1);
  });

  it('treats a session whose user row is gone as logged out, and deletes it', () => {
    const { db, t0 } = setup();
    const { token } = createSession(db, USER, t0);
    // As if deleted from the sqlite3 CLI without PRAGMA foreign_keys = ON.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec("DELETE FROM users WHERE id = 'u1'");
    expect(loadSession(db, token, t0)).toBeUndefined();
    expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  describe('rotateSession (step-up)', () => {
    it('replaces the token and records the approval, keeping auth_at and the absolute timeout', () => {
      const { db, t0 } = setup();
      const { token, session } = createSession(db, USER, t0);
      const t1 = after(t0, 60_000);
      const rotated = rotateSession(db, token, t1, { txHash: 'tx-1' });
      expect(rotated).toBeDefined();
      expect(rotated?.token).not.toBe(token);
      expect(loadSession(db, token, t1)).toBeUndefined();
      const loaded = loadSession(db, rotated?.token ?? '', t1);
      expect(loaded).toMatchObject({
        userId: 'u1',
        authAt: session.authAt,
        expiresAt: session.expiresAt,
        stepupAt: t1.toISOString(),
      });
      const row = db.prepare('SELECT approved_tx_hash FROM sessions').get() as {
        approved_tx_hash: string;
      };
      expect(row.approved_tx_hash).toBe('tx-1');
    });

    it('returns undefined when the old session is gone', () => {
      const { db, t0 } = setup();
      expect(rotateSession(db, 'no-such-token', t0, { txHash: 'tx-1' })).toBeUndefined();
      expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    });
  });
});
