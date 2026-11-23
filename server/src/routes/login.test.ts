import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiError,
  LoginOptionsResponse,
  LoginVerifyResponse,
  MeResponse,
  RegisterOptionsResponse,
  RegisterVerifyResponse,
} from '@app/shared';
import { TEST_CONFIG } from '../../test/registration-harness.js';
import { SoftAuthenticator } from '../../test/soft-authenticator.js';
import { Browser, startTestServer } from '../../test/test-server.js';

let server: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => {
  server.close();
});

/** Registers through the API and returns the browser (logged in) and what the authenticator kept. */
async function registerUser(displayName: string) {
  const browser = new Browser(server.baseUrl);
  const authenticator = new SoftAuthenticator();
  const options = RegisterOptionsResponse.parse(
    await (await browser.request('POST', '/api/register/options', { displayName })).json(),
  );
  const res = await browser.request(
    'POST',
    '/api/register/verify',
    authenticator.createCredential({
      challenge: options.challenge,
      origin: TEST_CONFIG.rpOrigin,
      rpId: options.rp.id,
    }),
  );
  const registered = RegisterVerifyResponse.parse(await res.json());
  return {
    browser,
    authenticator,
    userId: registered.userId,
    userHandle: Buffer.from(options.user.id, 'base64url'),
  };
}

async function login(
  browser: Browser,
  user: { authenticator: SoftAuthenticator; userHandle: Buffer },
  overrides = {},
) {
  const options = LoginOptionsResponse.parse(
    await (await browser.request('POST', '/api/login/options')).json(),
  );
  return browser.request(
    'POST',
    '/api/login/verify',
    user.authenticator.getAssertion(
      {
        challenge: options.challenge,
        origin: TEST_CONFIG.rpOrigin,
        rpId: options.rpId,
        userHandle: user.userHandle,
      },
      overrides,
    ),
  );
}

describe('registration logs the user in', () => {
  it('sets a session cookie and /api/me answers', async () => {
    const { browser, userId } = await registerUser('test-user-1');
    expect(browser.cookies.has('session')).toBe(true);
    const me = MeResponse.parse(await (await browser.request('GET', '/api/me')).json());
    expect(me).toMatchObject({ userId, displayName: 'test-user-1', stepupAt: null });
  });
});

describe('username-less login', () => {
  it('returns discoverable-credential options (empty allowCredentials)', async () => {
    const res = await new Browser(server.baseUrl).request('POST', '/api/login/options');
    const options = LoginOptionsResponse.parse(await res.json());
    expect(options.allowCredentials).toEqual([]);
    expect(options.userVerification).toBe('required');
  });

  it('logs in from a fresh browser with only the passkey', async () => {
    const user = await registerUser('test-user-2');
    const browser = new Browser(server.baseUrl);
    const res = await login(browser, user);
    expect(res.status).toBe(200);
    const body = LoginVerifyResponse.parse(await res.json());
    expect(body.me).toMatchObject({ userId: user.userId, displayName: 'test-user-2' });
    const me = MeResponse.parse(await (await browser.request('GET', '/api/me')).json());
    expect(me.userId).toBe(user.userId);
  });

  it('issues a new session ID at login and invalidates the old one (fixation)', async () => {
    const user = await registerUser('test-user-3');
    const before = user.browser.cookies.get('session');
    const stale = new Browser(server.baseUrl);
    stale.cookies.set('session', before ?? '');

    expect((await login(user.browser, user)).status).toBe(200);
    expect(user.browser.cookies.get('session')).not.toBe(before);
    expect((await stale.request('GET', '/api/me')).status).toBe(401);
  });

  it('reports which check rejected the login', async () => {
    const user = await registerUser('test-user-4');
    const res = await login(new Browser(server.baseUrl), user, { flags: { uv: false } });
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json())).toMatchObject({
      error: 'user_verification_required',
      check: 'A3',
    });
  });

  it("rejects the attacker's key with the victim's userHandle (L2)", async () => {
    const victim = await registerUser('test-user-5');
    const attacker = await registerUser('test-user-6');
    const res = await login(new Browser(server.baseUrl), attacker, {
      userHandle: victim.userHandle,
    });
    expect(ApiError.parse(await res.json())).toMatchObject({ check: 'L2' });
  });
});

describe('session endpoints', () => {
  it('/api/me requires a session', async () => {
    const res = await new Browser(server.baseUrl).request('GET', '/api/me');
    expect(res.status).toBe(401);
    expect(ApiError.parse(await res.json()).error).toBe('unauthenticated');
  });

  it('logout ends the session', async () => {
    const { browser } = await registerUser('test-user-7');
    expect((await browser.request('POST', '/api/logout')).status).toBe(204);
    expect(browser.cookies.has('session')).toBe(false);
    expect((await browser.request('GET', '/api/me')).status).toBe(401);
  });
});
