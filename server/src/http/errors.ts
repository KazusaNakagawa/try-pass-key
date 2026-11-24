import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiError, CeremonyInspection } from '@app/shared';
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
  R4: 'credential_id_too_long',
  R5: 'weak_public_key',
  L1: 'unknown_credential',
  L2: 'user_handle_mismatch',
  L3: 'signature_invalid',
  L4: 'backup_flags_mismatch',
  S1: 'credential_not_owned',
  // The client recovers by stepping up again for this transfer.
  S2: 'step_up_required',
  S3: 'step_up_required',
};

/** HTTP status per check: 401 where stepping up again fixes it, otherwise 400. */
export function checkErrorStatus(id: CheckId): number {
  return id === 'S2' || id === 'S3' ? 401 : 400;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Errors from body-parser (http-errors) carry a 4xx `status`. */
function isClientError(err: unknown): err is { status: number; message: string } {
  if (!(err instanceof Error) || !('status' in err)) return false;
  const status = err.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  const send = (status: number, body: ApiError) => res.status(status).json(body);
  // Set by runInspected in development only (M4).
  const inspection = res.locals.inspection as CeremonyInspection | undefined;
  const withInspection = inspection ? { inspection } : {};

  if (err instanceof CheckError) {
    console.warn(`[verify] rejected by ${err.message}`);
    send(checkErrorStatus(err.check), {
      error: CHECK_ERROR_CODES[err.check],
      detail: err.message,
      check: err.check,
      ...withInspection,
    });
  } else if (err instanceof ParseError) {
    send(400, { error: 'malformed_response', detail: err.message, ...withInspection });
  } else if (err instanceof ZodError) {
    send(400, { error: 'invalid_request', detail: err.issues.map((i) => i.message).join('; ') });
  } else if (err instanceof HttpError) {
    send(err.status, { error: err.code, detail: err.message });
  } else if (isClientError(err)) {
    // express.json() errors: malformed JSON (400), body too large (413), bad charset (415)
    send(err.status, {
      error: err.status === 413 ? 'payload_too_large' : 'invalid_request',
      detail: err.message,
    });
  } else {
    console.error('[server] unexpected error', err);
    send(500, { error: 'internal_error', detail: 'unexpected server error' });
  }
};
