import { Router } from 'express';
import {
  RegisterOptionsRequest,
  RegistrationResponse,
  type RegisterVerifyResponse,
} from '@app/shared';
import { CEREMONY_COOKIE, ceremonyCookieOptions, readCookie } from '../http/cookies.js';
import { startSession } from '../session/http.js';
import { runInspected } from './inspected.js';
import { REGISTRATION_CHECKS } from '../webauthn/pipeline.js';
import {
  buildRegistrationContext,
  createRegistrationOptions,
  saveRegistration,
  type RegistrationDeps,
} from '../webauthn/registration.js';

export function registerRoutes(deps: RegistrationDeps): Router {
  const router = Router();

  router.post('/api/register/options', (req, res) => {
    const { displayName } = RegisterOptionsRequest.parse(req.body);
    const { options, ceremonyId } = createRegistrationOptions(deps, displayName);
    res.cookie(CEREMONY_COOKIE, ceremonyId, ceremonyCookieOptions(deps.config));
    res.json(options);
  });

  router.post('/api/register/verify', (req, res) => {
    const response = RegistrationResponse.parse(req.body);
    const ceremonyId = readCookie(req, CEREMONY_COOKIE);
    // The cookie is single-use like the challenge: clear it whatever the outcome.
    res.clearCookie(CEREMONY_COOKIE, { ...ceremonyCookieOptions(deps.config), maxAge: undefined });

    const ctx = buildRegistrationContext(deps, { response, ceremonyId });
    const { saved, inspection } = runInspected({
      ceremony: 'register',
      ctx,
      checks: REGISTRATION_CHECKS,
      config: deps.config,
      res,
      save: () => saveRegistration(deps, ctx, response.response.transports ?? []),
    });
    // Registering also logs the user in, with a fresh session ID (D22).
    const session = startSession(deps, req, res, {
      id: saved.userId,
      displayName: saved.displayName,
    });
    const body: RegisterVerifyResponse = {
      ...saved,
      authAt: session.authAt,
      ...(inspection ? { inspection } : {}),
    };
    res.json(body);
  });

  return router;
}
