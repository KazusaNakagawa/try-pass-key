import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  Base64Url,
  RegistrationResponse,
  type AddCredentialVerifyResponse,
  type CredentialsResponse,
} from '@app/shared';
import type { Config } from '../config.js';
import {
  countCredentials,
  deleteCredentialUnlessLast,
  isCredentialOwnedBy,
  listCredentials,
} from '../credentials/credentials.js';
import { HttpError } from '../http/errors.js';
import { buildOperationGateContext } from '../operations/gate.js';
import { currentSession, requireSession, type SessionDeps } from '../session/http.js';
import {
  buildAddCredentialContext,
  createAddCredentialOptions,
  saveAddedCredential,
} from '../webauthn/add-credential.js';
import { runOperationGate } from '../webauthn/pipeline.js';
import { runInspected } from './inspected.js';

/**
 * The logged-in user's passkeys (docs/01 §5.4): list, add, delete. Adding and
 * deleting each need a step-up approval for that very operation.
 */
export function credentialRoutes(deps: SessionDeps): Router {
  const router = Router();

  router.get('/api/credentials', requireSession(deps), (_req, res) => {
    const body: CredentialsResponse = credentialsOf(deps, currentSession(res).userId);
    res.json(body);
  });

  // No gate here: a cancelled or refused creation can start over from options
  // while the approval lasts. The gate runs in verify, before anything is saved.
  router.post('/api/credentials/options', requireSession(deps), (_req, res) => {
    const session = currentSession(res);
    res.json(createAddCredentialOptions(deps, { userId: session.userId, sessionId: session.id }));
  });

  router.post('/api/credentials/verify', requireSession(deps), (req, res) => {
    const response = RegistrationResponse.parse(req.body);
    const session = currentSession(res);
    const ctx = buildAddCredentialContext(deps, {
      response,
      sessionUserId: session.userId,
      sessionId: session.id,
    });
    const { saved, inspection } = runInspected({
      ceremony: 'add_credential',
      ctx,
      config: deps.config,
      res,
      // After every registration check, so a broken response does not use the approval up.
      save: () => {
        runOperationGate(
          buildOperationGateContext(deps, {
            sessionId: session.id,
            op: { kind: 'add_credential' },
          }),
        );
        return saveAddedCredential(deps, ctx, response.response.transports ?? []);
      },
    });
    const credential = listCredentials(deps.db, saved.userId).find(
      (c) => c.id === saved.credential.id,
    );
    if (!credential) throw new Error('the added passkey was not stored');
    const body: AddCredentialVerifyResponse = {
      credential,
      ...(inspection ? { inspection } : {}),
    };
    res.json(body);
  });

  router.delete('/api/credentials/:id', requireSession(deps), (req, res) => {
    const id = Base64Url.min(1).parse(req.params.id);
    const session = currentSession(res);
    const credentialId = Buffer.from(id, 'base64url');
    // Before the gate: naming someone else's passkey must not use the approval up.
    assertDeletable(deps.db, session.userId, credentialId);
    runOperationGate(
      buildOperationGateContext(deps, {
        sessionId: session.id,
        op: { kind: 'delete_credential', credentialId: id },
      }),
    );
    if (!deleteCredentialUnlessLast(deps.db, session.userId, credentialId)) {
      throw lastCredential();
    }
    const body: CredentialsResponse = credentialsOf(deps, session.userId);
    res.json(body);
  });

  return router;
}

/**
 * 404 for a passkey that is not the user's (whether it exists or not), 409 for
 * their last one. Also checked before a step-up for deleting it.
 */
export function assertDeletable(db: DatabaseSync, userId: string, credentialId: Buffer): void {
  if (!isCredentialOwnedBy(db, userId, credentialId)) {
    throw new HttpError(404, 'credential_not_found', 'no such passkey on this account');
  }
  if (countCredentials(db, userId) <= 1) throw lastCredential();
}

function lastCredential(): HttpError {
  return new HttpError(409, 'last_credential', 'the last passkey of an account cannot be deleted');
}

function credentialsOf(deps: { db: DatabaseSync; config: Config }, userId: string) {
  const user = deps.db.prepare('SELECT user_handle FROM users WHERE id = ?').get(userId) as
    { user_handle: Uint8Array } | undefined;
  if (!user) throw new HttpError(401, 'unauthenticated', 'the user no longer exists');
  return {
    rpId: deps.config.rpId,
    userHandle: Buffer.from(user.user_handle).toString('base64url'),
    credentials: listCredentials(deps.db, userId),
  };
}
