import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, MeResponse, StepupOptionsResponse, StepupVerifyResponse } from '@app/shared';
import { registerUser, stepUp } from '../../test/api-helpers.js';
import { TEST_CONFIG } from '../../test/registration-harness.js';
import { Browser, startTestServer } from '../../test/test-server.js';
import { createSession } from '../session/sessions.js';

let server: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => {
  server.close();
});

const TX = { to: 'test-account-1', amount: 1000 };
const OP = { kind: 'transfer', ...TX } as const;

describe('POST /api/stepup/options', () => {
  it('requires a session', async () => {
    const res = await new Browser(server.baseUrl).request('POST', '/api/stepup/options', OP);
    expect(res.status).toBe(401);
    expect(ApiError.parse(await res.json()).error).toBe('unauthenticated');
  });

  it("offers only the session user's credentials", async () => {
    const user = await registerUser(server.baseUrl, 'test-user-1');
    await registerUser(server.baseUrl, 'test-user-2');
    const res = await user.browser.request('POST', '/api/stepup/options', OP);
    expect(res.status).toBe(200);
    const options = StepupOptionsResponse.parse(await res.json());
    const own = server.db
      .prepare('SELECT id FROM credentials WHERE user_id = ?')
      .all(user.userId)
      .map((r) => Buffer.from((r as { id: Uint8Array }).id).toString('base64url'));
    expect(options.allowCredentials.map((c) => c.id)).toEqual(own);
  });

  it('refuses more than the balance before the authenticator is asked', async () => {
    const user = await registerUser(server.baseUrl);
    const res = await user.browser.request('POST', '/api/stepup/options', {
      kind: 'transfer',
      to: 'test-account-1',
      amount: 100_001,
    });
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error).toBe('insufficient_funds');
  });
});

describe('POST /api/stepup/verify', () => {
  it('records the approval on a new session ID', async () => {
    const user = await registerUser(server.baseUrl);
    const before = user.browser.cookies.get('session');
    const res = await stepUp(user, OP);
    expect(res.status).toBe(200);
    const body = StepupVerifyResponse.parse(await res.json());
    expect(body.me.stepupAt).not.toBeNull();
    expect(body.inspection?.ceremony).toBe('stepup');
    expect(body.inspection?.checks.map((c) => c.id)).toContain('S1');
    expect(user.browser.cookies.get('session')).not.toBe(before);
    const me = MeResponse.parse(await (await user.browser.request('GET', '/api/me')).json());
    expect(me.stepupAt).toBe(body.me.stepupAt);
  });

  it('makes the old session cookie useless', async () => {
    const user = await registerUser(server.baseUrl);
    const stale = new Browser(server.baseUrl);
    stale.cookies.set('session', user.browser.cookies.get('session') ?? '');
    expect((await stepUp(user, OP)).status).toBe(200);
    expect((await stale.request('GET', '/api/me')).status).toBe(401);
  });

  it('accepts a response without userHandle', async () => {
    const user = await registerUser(server.baseUrl);
    expect((await stepUp(user, OP, { userHandle: null })).status).toBe(200);
  });

  it("rejects a step-up response redeemed in the same user's other session (C5)", async () => {
    const user = await registerUser(server.baseUrl);
    // A second session of the same user, e.g. a stolen cookie.
    const other = new Browser(server.baseUrl);
    other.cookies.set(
      'session',
      createSession(server.db, { id: user.userId, displayName: 'test-user-1' }, new Date()).token,
    );
    const options = StepupOptionsResponse.parse(
      await (await user.browser.request('POST', '/api/stepup/options', OP)).json(),
    );
    const leaked = user.authenticator.getAssertion({
      challenge: options.challenge,
      origin: TEST_CONFIG.rpOrigin,
      rpId: options.rpId,
      userHandle: user.userHandle,
    });
    const res = await other.request('POST', '/api/stepup/verify', leaked);
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json())).toMatchObject({ check: 'C5' });
  });

  it("rejects the attacker's own passkey in the victim's session (S1)", async () => {
    const victim = await registerUser(server.baseUrl, 'test-user-1');
    const attacker = await registerUser(server.baseUrl, 'test-user-2');
    const res = await stepUp(victim, OP, { userHandle: null }, attacker);
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body).toMatchObject({ error: 'credential_not_owned', check: 'S1' });
    expect(body.inspection?.ceremony).toBe('stepup');
  });
});
