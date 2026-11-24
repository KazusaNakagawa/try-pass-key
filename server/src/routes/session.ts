import { Router } from 'express';
import type { MeResponse } from '@app/shared';
import {
  currentSession,
  endSession,
  requireSession,
  toMeResponse,
  type SessionDeps,
} from '../session/http.js';

export function sessionRoutes(deps: SessionDeps): Router {
  const router = Router();

  router.get('/api/me', requireSession(deps), (_req, res) => {
    const body: MeResponse = toMeResponse(deps.db, currentSession(res));
    res.json(body);
  });

  router.post('/api/logout', (req, res) => {
    endSession(deps, req, res);
    res.status(204).end();
  });

  return router;
}
