import type { RequestHandler } from 'express';
import { HttpError } from './errors.js';

/**
 * CSRF defense for state-changing requests (docs/01 §7): the browser's Origin
 * header must be the RP origin. This is the HTTP header, separate from the
 * origin inside clientDataJSON (C3).
 */
export function requireSameOrigin(rpOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      next();
      return;
    }
    const origin = req.get('origin');
    if (origin !== rpOrigin) {
      next(new HttpError(403, 'invalid_request_origin', `Origin ${String(origin)} is not allowed`));
      return;
    }
    next();
  };
}
