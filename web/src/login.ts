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
  const options = await postJson('/api/login/options', {}, LoginOptionsResponse);
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
 * Cancels a pending Conditional UI request. Starting another ceremony also
 * replaces the ceremony cookie, so the pending request could not succeed anyway
 * (docs/01 K8).
 */
export function cancelConditionalUI(): void {
  generation++;
  WebAuthnAbortService.cancelCeremony();
}

/** Bumped on every cancellation, so a Conditional UI request still fetching options knows to stop. */
let generation = 0;
