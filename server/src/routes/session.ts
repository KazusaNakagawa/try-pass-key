import { Router } from 'express';
import type { MeResponse } from '@app/shared';
import { currentSession, endSession, requireSession, type SessionDeps } from '../session/http.js';

export function sessionRoutes(deps: SessionDeps): Router {
  const router = Router();

  router.get('/api/me', requireSession(deps), (_req, res) => {
    const session = currentSession(res);
    const body: MeResponse = {
      userId: session.userId,
      displayName: session.displayName,
      authAt: session.authAt,
      stepupAt: session.stepupAt,
      balance: session.balance,
    };
    res.json(body);
  });

  router.post('/api/logout', (req, res) => {
    endSession(deps, req, res);
    res.status(204).end();
  });

  return router;
}
