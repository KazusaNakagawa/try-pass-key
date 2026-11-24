import { startRegistration } from '@simplewebauthn/browser';
import {
  AddCredentialVerifyResponse,
  CredentialsResponse,
  RegisterOptionsResponse,
  type StepupVerifyResponse,
} from '@app/shared';
import { deleteJson, getJson, postJson } from './api.js';
import { signalAccepted } from './signal.js';
import { isStepUpRequired, stepUpFor } from './stepup.js';

export async function loadCredentials(): Promise<CredentialsResponse> {
  const list = await getJson('/api/credentials', CredentialsResponse);
  signalAccepted(acceptedOf(list));
  return list;
}

/**
 * Adds a passkey (docs/01 §5.4). The server hands out options only while the
 * session holds a fresh approval to add a passkey (D48), so the passkey is never
 * created when verify would refuse it. Without one, step up and ask again. If
 * creating fails (cancelled, or an authenticator that already holds one of this
 * user's passkeys), the approval is still on the session and calling this again
 * goes straight to the creation.
 */
export async function addPasskey(hooks: {
  onStepUp: () => void;
  onApproved: (stepup: StepupVerifyResponse) => void;
  onCreating: () => void;
}): Promise<AddCredentialVerifyResponse> {
  let options: RegisterOptionsResponse;
  try {
    options = await postJson('/api/credentials/options', {}, RegisterOptionsResponse);
  } catch (err) {
    if (!isStepUpRequired(err)) throw err;
    hooks.onStepUp();
    hooks.onApproved(await stepUpFor({ kind: 'add_credential' }));
    options = await postJson('/api/credentials/options', {}, RegisterOptionsResponse);
  }
  hooks.onCreating();
  const credential = await startRegistration({ optionsJSON: options });
  return postJson('/api/credentials/verify', credential, AddCredentialVerifyResponse);
}

/** Deletes a passkey, stepping up for that very passkey when the server asks. */
export async function deletePasskey(
  credentialId: string,
  hooks: { onStepUp: () => void; onApproved: (stepup: StepupVerifyResponse) => void },
): Promise<CredentialsResponse> {
  const path = `/api/credentials/${credentialId}`;
  let list: CredentialsResponse;
  try {
    list = await deleteJson(path, CredentialsResponse);
  } catch (err) {
    if (!isStepUpRequired(err)) throw err;
    hooks.onStepUp();
    hooks.onApproved(await stepUpFor({ kind: 'delete_credential', credentialId }));
    list = await deleteJson(path, CredentialsResponse);
  }
  signalAccepted(acceptedOf(list));
  return list;
}

const acceptedOf = (list: CredentialsResponse) => ({
  rpId: list.rpId,
  userHandle: list.userHandle,
  credentialIds: list.credentials.map((c) => c.id),
});
