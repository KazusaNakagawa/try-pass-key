import { Router } from 'express';
import { AuthenticationResponse, TransferRequest, type StepupVerifyResponse } from '@app/shared';
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
import { transferTxHash } from '../transfer/tx-hash.js';
import { approveStepup, buildStepupContext, createStepupOptions } from '../webauthn/stepup.js';
import { runInspected } from './inspected.js';

/** Re-authentication that approves one transfer (docs/01 §5.3). */
export function stepupRoutes(deps: SessionDeps): Router {
  const router = Router();

  router.post('/api/stepup/options', requireSession(deps), (req, res) => {
    const tx = TransferRequest.parse(req.body);
    const session = currentSession(res);
    // Refuse now rather than after the user has approved a transfer that cannot happen.
    if (getBalance(deps.db, session.userId) < tx.amount) {
      throw new HttpError(400, 'insufficient_funds', 'the balance is not enough for this transfer');
    }
    res.json(
      createStepupOptions(deps, {
        userId: session.userId,
        sessionId: session.id,
        txHash: transferTxHash(tx),
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
