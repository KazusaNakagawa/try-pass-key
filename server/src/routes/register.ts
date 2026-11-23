import { Router } from 'express';
import {
  RegisterOptionsRequest,
  RegistrationResponse,
  type RegisterVerifyResponse,
} from '@app/shared';
import { CEREMONY_COOKIE, ceremonyCookieOptions, readCookie } from '../http/cookies.js';
import { REGISTRATION_CHECKS, runChecks } from '../webauthn/pipeline.js';
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
    runChecks(ctx, REGISTRATION_CHECKS);
    const body: RegisterVerifyResponse = saveRegistration(
      deps,
      ctx,
      response.response.transports ?? [],
    );
    // Session issuance after registration comes with login in M3 (D22).
    res.json(body);
  });

  return router;
}
