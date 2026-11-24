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

/** The server's step-up window (STEPUP_TTL_MS), less a margin for the ceremony itself. */
const ADD_APPROVAL_REUSE_MS = 5 * 60 * 1000 - 30_000;

/**
 * Whether the approval to add a passkey is still worth using. Past this, the
 * server may refuse it in verify after the authenticator has already created
 * the passkey, which would leave a passkey the server never stored.
 */
export function canReuseAddApproval(approvedAt: Date | undefined, now: Date): boolean {
  if (!approvedAt) return false;
  const age = now.getTime() - approvedAt.getTime();
  return age >= 0 && age < ADD_APPROVAL_REUSE_MS;
}

/** When this page last got an approval to add a passkey, until a passkey is added. */
let addApprovedAt: Date | undefined;

export async function loadCredentials(): Promise<CredentialsResponse> {
  const list = await getJson('/api/credentials', CredentialsResponse);
  signalAccepted(acceptedOf(list));
  return list;
}

/**
 * Adds a passkey (docs/01 §5.4). Steps up first, unless an approval from an
 * earlier attempt is still fresh: the server checks it in verify, after the
 * authenticator has created the passkey, so asking for it up front avoids
 * creating a passkey the server would then refuse. If creating fails (cancelled,
 * or an authenticator that already holds one of this user's passkeys), the
 * approval is kept and calling this again goes straight to the creation.
 */
export async function addPasskey(hooks: {
  onStepUp: () => void;
  onApproved: (stepup: StepupVerifyResponse) => void;
  onCreating: () => void;
}): Promise<AddCredentialVerifyResponse> {
  if (!canReuseAddApproval(addApprovedAt, new Date())) {
    hooks.onStepUp();
    const stepup = await stepUpFor({ kind: 'add_credential' });
    addApprovedAt = new Date();
    hooks.onApproved(stepup);
  }
  hooks.onCreating();
  const options = await postJson('/api/credentials/options', {}, RegisterOptionsResponse);
  const credential = await startRegistration({ optionsJSON: options });
  try {
    const added = await postJson(
      '/api/credentials/verify',
      credential,
      AddCredentialVerifyResponse,
    );
    addApprovedAt = undefined;
    return added;
  } catch (err) {
    // The approval is gone (expired or used): the next attempt steps up again.
    if (isStepUpRequired(err)) addApprovedAt = undefined;
    throw err;
  }
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
