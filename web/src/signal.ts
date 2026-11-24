/**
 * Signal API (WebAuthn L3 §5.1.10-12): tells the authenticator which passkeys
 * this RP still accepts, so a deleted one can be removed or hidden there
 * (docs/01 K2). Only called where the browser has it; what the authenticator
 * does with the signal is up to it. Failures are logged, never shown.
 */
interface SignalApi {
  signalAllAcceptedCredentials?: (options: {
    rpId: string;
    userId: string;
    allAcceptedCredentialIds: string[];
  }) => Promise<void>;
  signalUnknownCredential?: (options: { rpId: string; credentialId: string }) => Promise<void>;
}

const api = (): SignalApi | undefined =>
  typeof PublicKeyCredential === 'undefined' ? undefined : PublicKeyCredential;

/** After listing or deleting: every passkey not in `credentialIds` is no longer accepted. */
export function signalAccepted(input: {
  rpId: string;
  userHandle: string;
  credentialIds: string[];
}): void {
  const signal = api()?.signalAllAcceptedCredentials;
  if (!signal) return;
  signal
    .call(PublicKeyCredential, {
      rpId: input.rpId,
      userId: input.userHandle,
      allAcceptedCredentialIds: input.credentialIds,
    })
    .catch((err: unknown) => {
      console.warn('[signal] signalAllAcceptedCredentials failed', err);
    });
}

/** After a login rejected as an unknown credential (L1). */
export function signalUnknown(rpId: string, credentialId: string): void {
  const signal = api()?.signalUnknownCredential;
  if (!signal) return;
  signal.call(PublicKeyCredential, { rpId, credentialId }).catch((err: unknown) => {
    console.warn('[signal] signalUnknownCredential failed', err);
  });
}
