import { describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { toMeResponse } from './http.js';
import { createSession } from './sessions.js';

describe('toMeResponse', () => {
  it('reads the balance now, not when the session was loaded', () => {
    const db = openDb(':memory:');
    db.exec(
      "INSERT INTO users VALUES ('u1', x'01', 'test-user-1', 100000, '2026-01-01T00:00:00Z')",
    );
    const { session } = createSession(db, { id: 'u1', displayName: 'test-user-1' }, new Date());
    db.exec("UPDATE users SET balance = 99000 WHERE id = 'u1'");
    expect(toMeResponse(db, session)).toEqual({
      userId: 'u1',
      displayName: 'test-user-1',
      authAt: session.authAt,
      stepupAt: null,
      balance: 99000,
    });
  });
});
