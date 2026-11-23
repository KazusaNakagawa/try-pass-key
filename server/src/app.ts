import express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { HealthResponse } from '@app/shared';
import type { Config } from './config.js';
import { listTables } from './db.js';
import { errorHandler } from './http/errors.js';
import { requireSameOrigin } from './http/origin.js';
import { loginRoutes } from './routes/login.js';
import { registerRoutes } from './routes/register.js';
import { sessionRoutes } from './routes/session.js';

export interface AppDeps {
  db: DatabaseSync;
  config: Config;
  /** Injected so tests can control expiry. */
  now?: () => Date;
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => new Date());
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use('/api', requireSameOrigin(deps.config.rpOrigin));

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok', db: { tables: listTables(deps.db) } };
    res.json(body);
  });

  const routeDeps = { db: deps.db, config: deps.config, now };
  app.use(registerRoutes(routeDeps));
  app.use(loginRoutes(routeDeps));
  app.use(sessionRoutes(routeDeps));

  app.use(errorHandler);
  return app;
}
