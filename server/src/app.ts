import express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { HealthResponse } from '@app/shared';
import { listTables } from './db.js';

export function createApp(deps: { db: DatabaseSync }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok', db: { tables: listTables(deps.db) } };
    res.json(body);
  });

  return app;
}
