import { Router } from 'express';
import type { MeResponse } from '@app/shared';
import { currentSession, endSession, requireSession, type SessionDeps } from '../session/http.js';

export function sessionRoutes(deps: SessionDeps): Router {
  const router = Router();

  router.get('/api/me', requireSession(deps), (_req, res) => {
    const session = currentSession(res);
    const user = deps.db
      .prepare('SELECT display_name FROM users WHERE id = ?')
      .get(session.userId) as { display_name: string } | undefined;
    if (!user) throw new Error('session user no longer exists');
    const body: MeResponse = {
      userId: session.userId,
      displayName: user.display_name,
      authAt: session.authAt,
      stepupAt: session.stepupAt,
    };
    res.json(body);
  });

  router.post('/api/logout', (req, res) => {
    endSession(deps, req, res);
    res.status(204).end();
  });

  return router;
}
