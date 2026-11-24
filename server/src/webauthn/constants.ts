import { COSE_ALG } from './cose.js';

/** How long an issued challenge stays valid (docs/01 §5.1). */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Algorithms offered in pubKeyCredParams and accepted by R1. */
export const SUPPORTED_ALGORITHMS: readonly number[] = [COSE_ALG.ES256, COSE_ALG.RS256];

export const RP_NAME = 'try-pass-key';

/** How long a step-up approval stays usable (docs/01 §8, Q3). */
export const STEPUP_TTL_MS = 5 * 60 * 1000;

/**
 * Adding a passkey (D48): options are refused unless the add approval has at
 * least this long left, and the browser's WebAuthn timeout is the time left
 * less ADD_CREDENTIAL_MARGIN_MS, so a ceremony ends before the approval does.
 */
export const ADD_CREDENTIAL_MIN_TIME_LEFT_MS = 60 * 1000;
export const ADD_CREDENTIAL_MARGIN_MS = 30 * 1000;

/** Mock balance given to every new user, so the transfer can be tried (M6). */
export const INITIAL_BALANCE = 100_000;
