import { describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { HttpError } from './http/errors.js';
import { getBalance } from './users.js';

describe('getBalance', () => {
  it("returns the user's balance", () => {
    const db = openDb(':memory:');
    db.exec("INSERT INTO users VALUES ('u1', x'01', 'test-user-1', 1234, '2026-01-01T00:00:00Z')");
    expect(getBalance(db, 'u1')).toBe(1234);
  });

  it('answers 401 when the user is gone, not a 500', () => {
    const db = openDb(':memory:');
    let caught: unknown;
    try {
      getBalance(db, 'gone');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect(caught).toMatchObject({ status: 401, code: 'unauthenticated' });
  });
});
