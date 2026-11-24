import { DatabaseSync } from 'node:sqlite';

/**
 * Schema from docs/01 §8. Timestamps are ISO 8601 strings (UTC).
 * Binary values (user handle, credential ID, public key, challenge) are BLOBs.
 *
 * Every PRIMARY KEY is also NOT NULL: in SQLite a non-INTEGER primary key on a
 * rowid table accepts NULL, so a bug that binds `undefined` would otherwise
 * insert NULL-keyed rows without any uniqueness.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id           TEXT NOT NULL PRIMARY KEY,      -- internal ID (UUID)
  user_handle  BLOB NOT NULL UNIQUE,           -- WebAuthn user.id (random, no personal data)
  display_name TEXT NOT NULL,
  balance      INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),  -- mock balance; no overdraft even if app code is wrong
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id              BLOB NOT NULL PRIMARY KEY,   -- credentialId
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key      BLOB NOT NULL,               -- COSE key
  sign_count      INTEGER NOT NULL,
  transports      TEXT NOT NULL DEFAULT '[]',  -- JSON array
  backup_eligible INTEGER NOT NULL,            -- BE flag (0/1)
  backup_state    INTEGER NOT NULL,            -- BS flag (0/1)
  aaguid          TEXT NOT NULL,               -- authenticator model; not always zero with "none" (1Password sends its own)
  created_at      TEXT NOT NULL,
  last_used_at    TEXT
);
CREATE INDEX IF NOT EXISTS credentials_user_id ON credentials(user_id);

-- One row per ceremony. Looked up by the challenge value in clientDataJSON (C2),
-- its id must equal the "ceremony" cookie (C5; for step-up, session_id must equal
-- the requesting session), and it is deleted on first use (C4).
CREATE TABLE IF NOT EXISTS challenges (
  id           TEXT NOT NULL PRIMARY KEY,
  challenge    BLOB NOT NULL UNIQUE,
  purpose      TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'stepup', 'add_credential')),
  user_handle  BLOB,                           -- register only
  display_name TEXT,                           -- register only
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,  -- stepup, add_credential
  tx_hash      TEXT,                           -- stepup only
  session_id   TEXT,                           -- stepup, add_credential: sessions.id that asked (no FK: rotation replaces it)
  expires_at   TEXT NOT NULL,
  -- Columns each purpose depends on. A NULL here would make the D14 binding or the
  -- tx_hash comparison compare against NULL, which can fail open in app code.
  CHECK (purpose <> 'register' OR (user_handle IS NOT NULL AND display_name IS NOT NULL)),
  CHECK (purpose <> 'stepup' OR (user_id IS NOT NULL AND tx_hash IS NOT NULL AND session_id IS NOT NULL)),
  CHECK (purpose <> 'add_credential' OR (user_id IS NOT NULL AND session_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS challenges_expires_at ON challenges(expires_at);
CREATE INDEX IF NOT EXISTS challenges_user_id ON challenges(user_id);

-- The session token (32 random bytes) lives only in the cookie. The DB keeps its
-- SHA-256, so a leaked database does not hand out live sessions.
CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT NOT NULL PRIMARY KEY,  -- SHA-256(token), base64url
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_at          TEXT NOT NULL,              -- when the user logged in (or registered)
  last_seen_at     TEXT NOT NULL,              -- for the idle timeout
  stepup_at        TEXT,
  approved_tx_hash TEXT,                       -- single use
  expires_at       TEXT NOT NULL               -- absolute timeout
);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS transfers (
  id         TEXT NOT NULL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_account TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transfers_user_id ON transfers(user_id);
`;

/**
 * Bump when SCHEMA_SQL changes. There are no migrations in this PoC (D26):
 * CREATE TABLE IF NOT EXISTS silently keeps an old table, so an outdated
 * database is refused instead, and `docker compose down -v` recreates it.
 */
export const SCHEMA_VERSION = 4;

export class OutdatedSchemaError extends Error {
  constructor(found: number) {
    super(
      `database schema version ${found} does not match ${SCHEMA_VERSION} ` +
        `(${found < SCHEMA_VERSION ? 'older' : 'newer, from another branch?'}). ` +
        'This PoC has no migrations: reset with `docker compose down -v` ' +
        '(and delete the old localhost passkeys from your password manager).',
    );
    this.name = 'OutdatedSchemaError';
  }
}

/** Opens the database and creates the schema if it does not exist yet. */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  if (version === 0 && listTables(db).length > 0) {
    // Created before versioning existed.
    db.close();
    throw new OutdatedSchemaError(0);
  }
  // Newer is refused too: an older checkout would keep the newer tables and
  // silently rewrite the version.
  if (version !== 0 && version !== SCHEMA_VERSION) {
    db.close();
    throw new OutdatedSchemaError(version);
  }
  db.exec(SCHEMA_SQL);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return db;
}

export function listTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

let savepoints = 0;

/**
 * Runs fn atomically: everything it wrote is rolled back if it throws. Uses a
 * SAVEPOINT, so it nests inside another call (or an open transaction).
 */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  const name = `sp_${++savepoints}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  }
}
