import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { deleteExpiredChallenges } from './webauthn/challenges.js';

const config = loadConfig();
// DB_PATH comes from validated config (compose sets /data/app.db), not from user input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
mkdirSync(dirname(config.dbPath), { recursive: true });
const db = openDb(config.dbPath);
const app = createApp({ db, config });

// Abandoned ceremonies leave challenge rows behind; delete expired ones (docs/01 §8).
const CLEANUP_INTERVAL_MS = 60 * 1000;
const cleanup = () => {
  const deleted = deleteExpiredChallenges(db, new Date());
  if (deleted > 0) console.log(`[server] deleted ${deleted} expired challenge(s)`);
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
