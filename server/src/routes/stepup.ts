import { Router } from 'express';
import { AuthenticationResponse, StepupOperation, type StepupVerifyResponse } from '@app/shared';
import { HttpError } from '../http/errors.js';
import {
  currentSession,
  requireSession,
  sessionToken,
  setSessionCookie,
  toMeResponse,
  type SessionDeps,
} from '../session/http.js';
import { getBalance } from '../users.js';
import { assertDeletable } from './credentials.js';
import { operationHash } from '../operations/operation-hash.js';
import { approveStepup, buildStepupContext, createStepupOptions } from '../webauthn/stepup.js';
import { runInspected } from './inspected.js';

/** Re-authentication that approves one operation (docs/01 §5.3, §5.4). */
export function stepupRoutes(deps: SessionDeps): Router {
  const router = Router();

  router.post('/api/stepup/options', requireSession(deps), (req, res) => {
    const op = StepupOperation.parse(req.body);
    const session = currentSession(res);
    // Refuse now rather than after the user has approved an operation that cannot happen.
    if (op.kind === 'transfer' && getBalance(deps.db, session.userId) < op.amount) {
      throw new HttpError(400, 'insufficient_funds', 'the balance is not enough for this transfer');
    }
    if (op.kind === 'delete_credential') {
      assertDeletable(deps.db, session.userId, Buffer.from(op.credentialId, 'base64url'));
    }
    res.json(
      createStepupOptions(deps, {
        userId: session.userId,
        sessionId: session.id,
        txHash: operationHash(op),
      }),
    );
  });

  router.post('/api/stepup/verify', requireSession(deps), (req, res) => {
    const response = AuthenticationResponse.parse(req.body);
    const { userId, id } = currentSession(res);
    const ctx = buildStepupContext(deps, { response, sessionUserId: userId, sessionId: id });
    const { saved, inspection } = runInspected({
      ceremony: 'stepup',
      ctx,
      config: deps.config,
      res,
      // Counter and new session in one transaction (approveStepup).
      save: () => approveStepup(deps, ctx, sessionToken(req)),
    });
    setSessionCookie(deps, res, saved.token);
    const session = saved.session;

    const body: StepupVerifyResponse = {
      me: toMeResponse(deps.db, session),
      credential: saved.credential,
      ...(inspection ? { inspection } : {}),
    };
    res.json(body);
  });

  return router;
}
