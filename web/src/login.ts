import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
} from '@simplewebauthn/browser';
import { LoginOptionsResponse, LoginVerifyResponse } from '@app/shared';
import { postJson } from './api.js';

/**
 * Login ceremony (docs/01 §5.2). allowCredentials is empty, so the authenticator
 * lists its passkeys for this RP and the user picks one; no username is sent.
 *
 * With `useBrowserAutofill`, the request waits silently until the user picks a
 * passkey from the username field's autofill (Conditional UI).
 */
export async function loginWithPasskey(useBrowserAutofill = false): Promise<LoginVerifyResponse> {
  const started = generation;
  const request = postJson('/api/login/options', {}, LoginOptionsResponse);
  if (useBrowserAutofill) optionsInFlight = request;
  const options = await request;
  // cancelConditionalUI() may have run while the options were in flight. Starting
  // now would abort the ceremony that replaced this one.
  if (useBrowserAutofill && started !== generation) {
    throw new DOMException('Conditional UI was cancelled', 'AbortError');
  }
  const credential = await startAuthentication({ optionsJSON: options, useBrowserAutofill });
  return postJson('/api/login/verify', credential, LoginVerifyResponse);
}

export async function supportsConditionalUI(): Promise<boolean> {
  return browserSupportsWebAuthnAutofill();
}

/**
 * Cancels a pending Conditional UI request before another ceremony starts.
 *
 * Await it: if the Conditional UI request is still fetching its options, that
 * response carries a Set-Cookie for its own ceremony. Arriving after the new
 * ceremony's options, it would replace the cookie and the new ceremony would
 * fail C5. Waiting for it first means the new ceremony's cookie lands last.
 */
export async function cancelConditionalUI(): Promise<void> {
  generation++;
  WebAuthnAbortService.cancelCeremony();
  const pending = optionsInFlight;
  optionsInFlight = undefined;
  await pending?.catch(() => undefined);
}

/** Bumped on every cancellation, so a Conditional UI request still fetching options knows to stop. */
let generation = 0;
/** Options request of the current Conditional UI attempt, if still in flight. */
let optionsInFlight: Promise<unknown> | undefined;
