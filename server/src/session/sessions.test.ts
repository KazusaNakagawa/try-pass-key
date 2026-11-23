import { describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import {
  createSession,
  deleteExpiredSessions,
  destroySession,
  loadSession,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from './sessions.js';

function setup() {
  const db = openDb(':memory:');
  db.exec("INSERT INTO users VALUES ('u1', x'01', 'test-user-1', 0, '2026-01-01T00:00:00Z')");
  return { db, t0: new Date('2026-01-01T00:00:00Z') };
}
const after = (t: Date, ms: number) => new Date(t.getTime() + ms);

describe('sessions', () => {
  it('stores only the SHA-256 of the token', () => {
    const { db, t0 } = setup();
    const token = createSession(db, 'u1', t0);
    const ids = db.prepare('SELECT id FROM sessions').all() as { id: string }[];
    expect(ids).toHaveLength(1);
    expect(ids[0]?.id).not.toBe(token);
    expect(loadSession(db, token, t0)?.userId).toBe('u1');
  });

  it('expires after 30 minutes idle', () => {
    const { db, t0 } = setup();
    const token = createSession(db, 'u1', t0);
    expect(loadSession(db, token, after(t0, SESSION_IDLE_MS - 1000))).toBeDefined();
    // Each access extends the idle timeout: still alive just under 30 minutes after the last one.
    expect(loadSession(db, token, after(t0, 2 * SESSION_IDLE_MS - 2000))).toBeDefined();
    expect(loadSession(db, token, after(t0, 3 * SESSION_IDLE_MS))).toBeUndefined();
  });

  it('expires after 8 hours even when active', () => {
    const { db, t0 } = setup();
    const token = createSession(db, 'u1', t0);
    for (let t = 0; t < SESSION_ABSOLUTE_MS; t += SESSION_IDLE_MS / 2) {
      expect(loadSession(db, token, after(t0, t))).toBeDefined();
    }
    expect(loadSession(db, token, after(t0, SESSION_ABSOLUTE_MS))).toBeUndefined();
  });

  it('is gone after destroy', () => {
    const { db, t0 } = setup();
    const token = createSession(db, 'u1', t0);
    destroySession(db, token);
    expect(loadSession(db, token, t0)).toBeUndefined();
  });

  it('cleans up expired sessions', () => {
    const { db, t0 } = setup();
    createSession(db, 'u1', t0);
    createSession(db, 'u1', after(t0, SESSION_IDLE_MS));
    expect(deleteExpiredSessions(db, after(t0, SESSION_IDLE_MS + 1000))).toBe(1);
  });
});
