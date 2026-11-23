import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb, OutdatedSchemaError } from './db.js';
import { deleteExpiredSessions } from './session/sessions.js';
import { deleteExpiredChallenges } from './webauthn/challenges.js';

const config = loadConfig();
// DB_PATH comes from validated config (compose sets /data/app.db), not from user input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
mkdirSync(dirname(config.dbPath), { recursive: true });
let db: ReturnType<typeof openDb>;
try {
  db = openDb(config.dbPath);
} catch (err) {
  if (err instanceof OutdatedSchemaError) {
    console.error(`[server] ${err.message}`);
    process.exit(1);
  }
  throw err;
}
const app = createApp({ db, config });

// Abandoned ceremonies and old sessions leave rows behind; delete expired ones (docs/01 §8).
const CLEANUP_INTERVAL_MS = 60 * 1000;
const cleanup = () => {
  const now = new Date();
  const challenges = deleteExpiredChallenges(db, now);
  const sessions = deleteExpiredSessions(db, now);
  if (challenges + sessions > 0) {
    console.log(`[server] deleted ${challenges} expired challenge(s), ${sessions} session(s)`);
  }
};
cleanup();
const cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

const server = app.listen(config.port, () => {
  console.log(
    `[server] listening on :${config.port} (rpId=${config.rpId}, origin=${config.rpOrigin}, db=${config.dbPath})`,
  );
});

// SIGINT and SIGTERM can both arrive (Ctrl-C twice, tsx watch, docker stop).
// Close only once: a second server.close() fails with ERR_SERVER_NOT_RUNNING and
// a second db.close() throws.
let closing = false;
function shutdown(signal: NodeJS.Signals) {
  if (closing) return;
  closing = true;
  clearInterval(cleanupTimer);
  console.log(`[server] ${signal} received, shutting down`);
  server.close((err) => {
    db.close();
    if (err) {
      console.error('[server] error while closing the HTTP server', err);
      process.exit(1);
    }
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
