import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiError } from '@app/shared';
import { CheckError, type CheckId } from '../webauthn/checks/types.js';
import { ParseError } from '../webauthn/errors.js';

/** Error codes per check (docs/01 §7). */
const CHECK_ERROR_CODES: Record<CheckId, string> = {
  C1: 'invalid_type',
  C2: 'invalid_challenge',
  C3: 'invalid_origin',
  C4: 'invalid_challenge',
  C5: 'invalid_challenge',
  A1: 'invalid_rp_id',
  A2: 'user_presence_required',
  A3: 'user_verification_required',
  A4: 'invalid_sign_count',
  R1: 'unsupported_algorithm',
  R2: 'credential_already_registered',
  R3: 'invalid_backup_flags',
  L1: 'unknown_credential',
  L2: 'user_handle_mismatch',
  L3: 'signature_invalid',
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  const send = (status: number, body: ApiError) => res.status(status).json(body);

  if (err instanceof CheckError) {
    console.warn(`[verify] rejected by ${err.message}`);
    send(400, { error: CHECK_ERROR_CODES[err.check], detail: err.message, check: err.check });
  } else if (err instanceof ParseError) {
    send(400, { error: 'malformed_response', detail: err.message });
  } else if (err instanceof ZodError) {
    send(400, { error: 'invalid_request', detail: err.issues.map((i) => i.message).join('; ') });
  } else if (err instanceof HttpError) {
    send(err.status, { error: err.code, detail: err.message });
  } else if (err instanceof SyntaxError) {
    // express.json() on a malformed body
    send(400, { error: 'invalid_request', detail: 'request body is not valid JSON' });
  } else {
    console.error('[server] unexpected error', err);
    send(500, { error: 'internal_error', detail: 'unexpected server error' });
  }
};
