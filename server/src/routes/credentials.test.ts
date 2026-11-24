import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AddCredentialVerifyResponse,
  ApiError,
  CredentialsResponse,
  type StepupOperation,
} from '@app/shared';
import {
  addCredential,
  addCredentialOptions,
  loginWith,
  registerUser,
  stepUp,
  submitAddCredential,
  type ApiUser,
} from '../../test/api-helpers.js';
import { SoftAuthenticator } from '../../test/soft-authenticator.js';
import { REGISTRATION_CHECKS } from '../webauthn/pipeline.js';
import { startTestServer } from '../../test/test-server.js';

let server: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => {
  server.close();
});

const ADD: StepupOperation = { kind: 'add_credential' };
const deleteOf = (credentialId: string): StepupOperation => ({
  kind: 'delete_credential',
  credentialId,
});
const idOf = (a: SoftAuthenticator) => a.credentialId.toString('base64url');

async function list(user: ApiUser) {
  const res = await user.browser.request('GET', '/api/credentials');
  expect(res.status).toBe(200);
  return CredentialsResponse.parse(await res.json());
}

async function expectError(res: Response, status: number, error: string, check?: string) {
  expect(res.status).toBe(status);
  const body = ApiError.parse(await res.json());
  expect(body.error).toBe(error);
  if (check) expect(body.check).toBe(check);
}

/** A user with a second passkey added through the API; returns that authenticator. */
async function withSecondPasskey(user: ApiUser): Promise<SoftAuthenticator> {
  const second = new SoftAuthenticator();
  expect((await stepUp(user, ADD)).status).toBe(200);
  expect((await addCredential(user, second)).status).toBe(200);
  return second;
}

describe('GET /api/credentials', () => {
  it('lists the one passkey of a new user, with the user handle and RP ID', async () => {
    const user = await registerUser(server.baseUrl);
    const body = await list(user);
    expect(body.credentials.map((c) => c.id)).toEqual([idOf(user.authenticator)]);
    expect(body.userHandle).toBe(user.userHandle.toString('base64url'));
    expect(body.rpId).toBe('localhost');
  });
});

describe('adding a passkey', () => {
  it("excludes the user's existing passkeys in the options", async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, ADD);
    const options = await addCredentialOptions(user);
    expect(options.excludeCredentials.map((c) => c.id)).toEqual([idOf(user.authenticator)]);
    expect(options.user.id).toBe(user.userHandle.toString('base64url'));
  });

  it('refuses options without an approval, before anything is created', async () => {
    const user = await registerUser(server.baseUrl);
    await expectError(
      await user.browser.request('POST', '/api/credentials/options'),
      401,
      'step_up_required',
    );
  });

  it('refuses options once the approval was used up by another request (D48)', async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, ADD);
    // An unapproved transfer runs the gate: S3 consumes the add approval, S2 refuses.
    const probe = await user.browser.request('POST', '/api/transfer', {
      to: 'test-account-1',
      amount: 1000,
    });
    expect(probe.status).toBe(401);
    await expectError(
      await user.browser.request('POST', '/api/credentials/options'),
      401,
      'step_up_required',
    );
  });

  it('refuses options when less than a minute of the approval is left', async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, ADD);
    const fourMinutesAgo = new Date(Date.now() - 4 * 60_000 - 1000).toISOString();
    server.db
      .prepare('UPDATE sessions SET stepup_at = ? WHERE user_id = ?')
      .run(fourMinutesAgo, user.userId);
    await expectError(
      await user.browser.request('POST', '/api/credentials/options'),
      401,
      'step_up_required',
    );
  });

  it('gives the browser only the time left on the approval, less a margin', async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, ADD);
    const options = await addCredentialOptions(user);
    expect(options.timeout).toBeLessThanOrEqual(5 * 60_000 - 30_000);
    expect(options.timeout).toBeGreaterThan(5 * 60_000 - 40_000);
  });

  it('is refused in verify when the approval is gone, and nothing is saved', async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, ADD);
    const options = await addCredentialOptions(user);
    await user.browser.request('POST', '/api/transfer', { to: 'test-account-1', amount: 1 });
    await expectError(
      await submitAddCredential(user, options, new SoftAuthenticator()),
      401,
      'step_up_required',
      'S3',
    );
    expect((await list(user)).credentials).toHaveLength(1);
  });

  it('adds a second passkey that logs in to the same account', async () => {
    const user = await registerUser(server.baseUrl);
    const second = await withSecondPasskey(user);
    expect((await list(user)).credentials.map((c) => c.id)).toEqual([
      idOf(user.authenticator),
      idOf(second),
    ]);
    const { res } = await loginWith(server.baseUrl, second, user.userHandle);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { me: { userId: string } }).me.userId).toBe(user.userId);
  });

  it('lets a failed creation start over from options, but one approval adds one passkey', async () => {
    const user = await registerUser(server.baseUrl);
    expect((await stepUp(user, ADD)).status).toBe(200);
    const cancelled = await addCredentialOptions(user); // the creation is cancelled
    const retried = await addCredentialOptions(user);
    expect((await submitAddCredential(user, retried, new SoftAuthenticator())).status).toBe(200);
    // The approval is used: neither new options nor the old ones get a second passkey in.
    await expectError(
      await user.browser.request('POST', '/api/credentials/options'),
      401,
      'step_up_required',
    );
    await expectError(
      await submitAddCredential(user, cancelled, new SoftAuthenticator()),
      401,
      'step_up_required',
      'S3',
    );
    expect((await list(user)).credentials).toHaveLength(2);
  });

  it('refuses options with only a transfer approval', async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, { kind: 'transfer', to: 'test-account-1', amount: 1000 });
    await expectError(
      await user.browser.request('POST', '/api/credentials/options'),
      401,
      'step_up_required',
    );
  });

  it('refuses add options issued before another step-up (the session was rotated, C5)', async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, ADD);
    const options = await addCredentialOptions(user);
    // A transfer step-up replaces the add approval and issues a new session ID.
    await stepUp(user, { kind: 'transfer', to: 'test-account-1', amount: 1000 });
    await expectError(
      await submitAddCredential(user, options, new SoftAuthenticator()),
      400,
      'invalid_challenge',
      'C5',
    );
  });

  it("refuses the attacker's key answering the victim's challenge from the attacker's session (C5)", async () => {
    const victim = await registerUser(server.baseUrl, 'test-user-1');
    const attacker = await registerUser(server.baseUrl, 'test-user-2');
    // The attacker holds a valid approval of their own, so only C5 stands in the way.
    expect((await stepUp(attacker, ADD)).status).toBe(200);
    await stepUp(victim, ADD);
    const leaked = await addCredentialOptions(victim);
    const res = await submitAddCredential(attacker, leaked, new SoftAuthenticator());
    await expectError(res, 400, 'invalid_challenge', 'C5');
    expect((await list(victim)).credentials).toHaveLength(1);
  });

  it('reports the ceremony as add_credential with the registration checks', async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, ADD);
    const res = await addCredential(user);
    const { inspection } = AddCredentialVerifyResponse.parse(await res.json());
    expect(inspection?.ceremony).toBe('add_credential');
    expect(inspection?.checks.map((c) => c.id)).toEqual(REGISTRATION_CHECKS.map((c) => c.id));
  });
});

describe('deleting a passkey', () => {
  it('deletes one of two passkeys after a step-up for it, even the one used to log in', async () => {
    const user = await registerUser(server.baseUrl);
    const second = await withSecondPasskey(user);
    expect((await stepUp(user, deleteOf(idOf(user.authenticator)), {}, user)).status).toBe(200);
    const res = await user.browser.request(
      'DELETE',
      `/api/credentials/${idOf(user.authenticator)}`,
    );
    expect(res.status).toBe(200);
    expect(CredentialsResponse.parse(await res.json()).credentials.map((c) => c.id)).toEqual([
      idOf(second),
    ]);
    expect((await user.browser.request('GET', '/api/me')).status).toBe(200);
  });

  it('is refused without a step-up', async () => {
    const user = await registerUser(server.baseUrl);
    const second = await withSecondPasskey(user);
    const res = await user.browser.request('DELETE', `/api/credentials/${idOf(second)}`);
    await expectError(res, 401, 'step_up_required', 'S3');
  });

  it('refuses the approval for passkey X when deleting passkey Y', async () => {
    const user = await registerUser(server.baseUrl);
    const second = await withSecondPasskey(user);
    await stepUp(user, deleteOf(idOf(second)));
    const res = await user.browser.request(
      'DELETE',
      `/api/credentials/${idOf(user.authenticator)}`,
    );
    await expectError(res, 401, 'step_up_required', 'S2');
  });

  it("answers 404 for someone else's passkey and keeps the approval", async () => {
    const user = await registerUser(server.baseUrl, 'test-user-1');
    const other = await registerUser(server.baseUrl, 'test-user-2');
    const second = await withSecondPasskey(user);
    await stepUp(user, deleteOf(idOf(second)));
    const res = await user.browser.request(
      'DELETE',
      `/api/credentials/${idOf(other.authenticator)}`,
    );
    await expectError(res, 404, 'credential_not_found');
    expect((await user.browser.request('DELETE', `/api/credentials/${idOf(second)}`)).status).toBe(
      200,
    );
  });

  it('refuses to step up for, or delete, the last passkey', async () => {
    const user = await registerUser(server.baseUrl);
    const id = idOf(user.authenticator);
    await expectError(
      await user.browser.request('POST', '/api/stepup/options', deleteOf(id)),
      409,
      'last_credential',
    );
    await expectError(
      await user.browser.request('DELETE', `/api/credentials/${id}`),
      409,
      'last_credential',
    );
  });

  it("refuses to step up for someone else's passkey", async () => {
    const user = await registerUser(server.baseUrl, 'test-user-1');
    const other = await registerUser(server.baseUrl, 'test-user-2');
    await withSecondPasskey(user);
    await expectError(
      await user.browser.request(
        'POST',
        '/api/stepup/options',
        deleteOf(idOf(other.authenticator)),
      ),
      404,
      'credential_not_found',
    );
  });

  it('rejects a malformed credential ID without using the approval', async () => {
    const user = await registerUser(server.baseUrl);
    const second = await withSecondPasskey(user);
    await stepUp(user, deleteOf(idOf(second)));
    await expectError(
      await user.browser.request('DELETE', '/api/credentials/not*base64'),
      400,
      'invalid_request',
    );
    await expectError(
      await user.browser.request('POST', '/api/stepup/options', deleteOf('')),
      400,
      'invalid_request',
    );
    expect((await user.browser.request('DELETE', `/api/credentials/${idOf(second)}`)).status).toBe(
      200,
    );
  });
});
