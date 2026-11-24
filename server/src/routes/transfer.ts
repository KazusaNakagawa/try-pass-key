import { Router } from 'express';
import { TransferRequest, type TransferResponse, type TransfersResponse } from '@app/shared';
import { currentSession, requireSession, type SessionDeps } from '../session/http.js';
import { buildOperationGateContext } from '../operations/gate.js';
import { executeTransfer, listTransfers } from '../transfer/transfer.js';
import { runOperationGate } from '../webauthn/pipeline.js';

/** Mock transfer behind a single-use step-up approval (docs/01 §5.3). */
export function transferRoutes(deps: SessionDeps): Router {
  const router = Router();

  router.post('/api/transfer', requireSession(deps), (req, res) => {
    // Parsed before the gate, so a malformed request does not use the approval up.
    const tx = TransferRequest.parse(req.body);
    const session = currentSession(res);
    runOperationGate(
      buildOperationGateContext(deps, {
        sessionId: session.id,
        op: { kind: 'transfer', ...tx },
      }),
    );
    const body: TransferResponse = executeTransfer(deps, { userId: session.userId, tx });
    res.json(body);
  });

  router.get('/api/transfers', requireSession(deps), (_req, res) => {
    const body: TransfersResponse = listTransfers(deps, currentSession(res).userId);
    res.json(body);
  });

  return router;
}
