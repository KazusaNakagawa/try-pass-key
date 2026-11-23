import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { listTables, openDb, OutdatedSchemaError, SCHEMA_VERSION } from './db.js';

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
        "INSERT INTO sessions (id, user_id, auth_at, last_seen_at, expires_at) VALUES ('s1', 'no-such-user', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T08:00:00Z')",
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

  it.each(['users', 'credentials', 'challenges', 'sessions', 'transfers'])(
    'declares the primary key of %s NOT NULL',
    (table) => {
      const db = openDb(':memory:');
      const pk = db.prepare(`SELECT "notnull" FROM pragma_table_info(?) WHERE pk = 1`).get(table);
      expect(pk).toEqual({ notnull: 1 });
    },
  );

  it('requires user_handle and display_name for a register challenge', () => {
    const db = openDb(':memory:');
    expect(() => {
      db.exec(
        "INSERT INTO challenges (id, challenge, purpose, expires_at) VALUES ('c1', x'00', 'register', '2026-01-01T00:05:00Z')",
      );
    }).toThrow(/CHECK/);
  });

  it('requires user_id and tx_hash for a stepup challenge', () => {
    const db = openDb(':memory:');
    db.exec("INSERT INTO users VALUES ('u1', x'01', 'test-user-1', 0, '2026-01-01T00:00:00Z')");
    expect(() => {
      db.exec(
        "INSERT INTO challenges (id, challenge, purpose, user_id, expires_at) VALUES ('c1', x'00', 'stepup', 'u1', '2026-01-01T00:05:00Z')",
      );
    }).toThrow(/CHECK/);
  });

  it('allows a login challenge without user columns', () => {
    const db = openDb(':memory:');
    expect(() => {
      db.exec(
        "INSERT INTO challenges (id, challenge, purpose, expires_at) VALUES ('c1', x'00', 'login', '2026-01-01T00:05:00Z')",
      );
    }).not.toThrow();
  });

  it('rejects a negative balance', () => {
    const db = openDb(':memory:');
    db.exec("INSERT INTO users VALUES ('u1', x'01', 'test-user-1', 100, '2026-01-01T00:00:00Z')");
    expect(() => {
      db.exec("UPDATE users SET balance = balance - 101 WHERE id = 'u1'");
    }).toThrow(/CHECK/);
  });

  it.each(['credentials', 'challenges', 'sessions', 'transfers'])(
    'indexes the user_id foreign key of %s',
    (table) => {
      const db = openDb(':memory:');
      const indexed = db
        .prepare(
          `SELECT 1 FROM pragma_index_list(?) AS l JOIN pragma_index_info(l.name) AS i WHERE i.name = 'user_id'`,
        )
        .all(table);
      expect(indexed).toHaveLength(1);
    },
  );

  it('refuses a database created before schema versioning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-test-'));
    try {
      const path = join(dir, 'app.db');
      const legacy = new DatabaseSync(path);
      legacy.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
      legacy.close();
      expect(() => openDb(path)).toThrow(OutdatedSchemaError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses an older schema version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-test-'));
    try {
      const path = join(dir, 'app.db');
      openDb(path).close();
      const db = new DatabaseSync(path);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`);
      db.close();
      expect(() => openDb(path)).toThrow(/down -v/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
