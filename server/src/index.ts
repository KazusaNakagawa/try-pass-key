import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const config = loadConfig();
// DB_PATH comes from validated config (compose sets /data/app.db), not from user input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
mkdirSync(dirname(config.dbPath), { recursive: true });
const db = openDb(config.dbPath);
const app = createApp({ db });

const server = app.listen(config.port, () => {
  console.log(
    `[server] listening on :${config.port} (rpId=${config.rpId}, origin=${config.rpOrigin}, db=${config.dbPath})`,
  );
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
