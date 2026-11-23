import { Router } from 'express';
import { AuthenticationResponse, type LoginVerifyResponse } from '@app/shared';
import { CEREMONY_COOKIE, ceremonyCookieOptions, readCookie } from '../http/cookies.js';
import { startSession, type SessionDeps } from '../session/http.js';
import {
  buildAuthenticationContext,
  createLoginOptions,
  saveAuthentication,
} from '../webauthn/authentication.js';
import { AUTHENTICATION_CHECKS, runChecks } from '../webauthn/pipeline.js';

export function loginRoutes(deps: SessionDeps): Router {
  const router = Router();

  router.post('/api/login/options', (_req, res) => {
    const { options, ceremonyId } = createLoginOptions(deps);
    res.cookie(CEREMONY_COOKIE, ceremonyId, ceremonyCookieOptions(deps.config));
    res.json(options);
  });

  router.post('/api/login/verify', (req, res) => {
    const response = AuthenticationResponse.parse(req.body);
    const ceremonyId = readCookie(req, CEREMONY_COOKIE);
    res.clearCookie(CEREMONY_COOKIE, { ...ceremonyCookieOptions(deps.config), maxAge: undefined });

    const ctx = buildAuthenticationContext(deps, { response, ceremonyId });
    runChecks(ctx, AUTHENTICATION_CHECKS);
    const { user, credential } = saveAuthentication(deps, ctx);
    const session = startSession(deps, req, res, user.id);

    const body: LoginVerifyResponse = {
      me: {
        userId: user.id,
        displayName: user.displayName,
        authAt: session.authAt,
        stepupAt: session.stepupAt,
      },
      credential,
    };
    res.json(body);
  });

  return router;
}
