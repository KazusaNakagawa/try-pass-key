import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listTables, openDb } from './db.js';

describe('openDb', () => {
  it('creates every table from docs/01 §8', () => {
    const db = openDb(':memory:');
    expect(listTables(db)).toEqual(['challenges', 'credentials', 'sessions', 'transfers', 'users']);
  });

  it('keeps existing data when reopened (server restart)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-test-'));
    try {
      const path = join(dir, 'app.db');
      const first = openDb(path);
      first.exec(
        "INSERT INTO users VALUES ('u1', x'01', 'test-user-1', 0, '2026-01-01T00:00:00Z')",
      );
      first.close();

      const second = openDb(path);
      expect(second.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces foreign keys', () => {
    const db = openDb(':memory:');
    expect(() => {
      db.exec(
        "INSERT INTO sessions VALUES ('s1', 'no-such-user', '2026-01-01T00:00:00Z', NULL, NULL, '2026-01-01T08:00:00Z')",
      );
    }).toThrow(/FOREIGN KEY/);
  });

  it('rejects an unknown challenge purpose', () => {
    const db = openDb(':memory:');
    expect(() => {
      db.exec(
        "INSERT INTO challenges (id, challenge, purpose, expires_at) VALUES ('c1', x'00', 'other', '2026-01-01T00:05:00Z')",
      );
    }).toThrow(/CHECK/);
  });
});
