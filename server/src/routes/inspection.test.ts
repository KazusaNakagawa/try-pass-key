import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiError,
  LoginOptionsResponse,
  LoginVerifyResponse,
  RegisterOptionsResponse,
  RegisterVerifyResponse,
  type CeremonyInspection,
} from '@app/shared';
import { loadConfig } from '../config.js';
import { TEST_CONFIG } from '../../test/registration-harness.js';
import { SoftAuthenticator, type AssertionOverrides } from '../../test/soft-authenticator.js';
import { Browser, startTestServer } from '../../test/test-server.js';
import { CheckError, type RegistrationContext } from '../webauthn/checks/types.js';
import { ParseError } from '../webauthn/errors.js';
import { inspectCeremony } from '../webauthn/inspect.js';
import { AUTHENTICATION_CHECKS, REGISTRATION_CHECKS } from '../webauthn/pipeline.js';

type Server = Awaited<ReturnType<typeof startTestServer>>;
let dev: Server;
let prod: Server;
beforeAll(async () => {
  dev = await startTestServer();
  prod = await startTestServer(loadConfig({ NODE_ENV: 'production' }));
});
afterAll(() => {
  dev.close();
  prod.close();
});

async function register(server: Server) {
  const browser = new Browser(server.baseUrl);
  const authenticator = new SoftAuthenticator();
  const options = RegisterOptionsResponse.parse(
    await (
      await browser.request('POST', '/api/register/options', { displayName: 'test-user-1' })
    ).json(),
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
  return {
    browser,
    authenticator,
    userHandle: Buffer.from(options.user.id, 'base64url'),
    body: await res.json(),
  };
}

async function login(
  server: Server,
  user: Awaited<ReturnType<typeof register>>,
  overrides: AssertionOverrides = {},
) {
  const options = LoginOptionsResponse.parse(
    await (await user.browser.request('POST', '/api/login/options')).json(),
  );
  return user.browser.request(
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

const resultOf = (inspection: CeremonyInspection | undefined, id: string) =>
  inspection?.checks.find((c) => c.id === id)?.result;

describe('inspection on verify responses (development)', () => {
  it('successful registration returns every check as pass', async () => {
    const { body } = await register(dev);
    const { inspection } = RegisterVerifyResponse.parse(body);
    expect(inspection?.ceremony).toBe('register');
    expect(inspection?.checks).toEqual(
      REGISTRATION_CHECKS.map((c) => ({ id: c.id, result: 'pass' })),
    );
    expect(inspection?.clientData.origin).toBe(TEST_CONFIG.rpOrigin);
    expect(inspection?.clientData.type).toBe('webauthn.create');
    expect(inspection?.expected.rpId).toBe(TEST_CONFIG.rpId);
    expect(inspection?.authenticatorData).toMatchObject({ flags: { uv: true, at: true } });
  });

  it('successful login includes the stored credential', async () => {
    const user = await register(dev);
    const res = await login(dev, user);
    const { inspection } = LoginVerifyResponse.parse(await res.json());
    expect(inspection?.ceremony).toBe('login');
    expect(inspection?.checks).toEqual(
      AUTHENTICATION_CHECKS.map((c) => ({ id: c.id, result: 'pass' })),
    );
    expect(inspection?.storedCredential).toEqual({
      signCount: 0,
      // SoftAuthenticator defaults to a synced passkey (BE=1, BS=1).
      backupEligible: true,
      backupState: true,
    });
  });

  it('tampered origin fails C3 and stops the pipeline', async () => {
    const user = await register(dev);
    const res = await login(dev, user, { origin: 'https://evil.example' });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.check).toBe('C3');
    const { inspection } = body;
    expect(inspection?.clientData.origin).toBe('https://evil.example');
    expect(inspection?.expected.origin).toBe(TEST_CONFIG.rpOrigin);
    expect(resultOf(inspection, 'C1')).toBe('pass');
    expect(resultOf(inspection, 'C3')).toBe('fail');
    for (const id of ['A1', 'A2', 'A3', 'L1', 'L2', 'L3', 'L4', 'A4']) {
      expect(resultOf(inspection, id)).toBe('not_run');
    }
    expect(inspection?.failure).toMatchObject({ check: 'C3', kind: 'check' });
  });

  it('unknown credential fails L1 without a stored credential', async () => {
    const user = await register(dev);
    const res = await login(dev, user, { credentialId: randomBytes(32) });
    const { inspection } = ApiError.parse(await res.json());
    expect(resultOf(inspection, 'L1')).toBe('fail');
    expect(inspection?.storedCredential).toBeUndefined();
  });
});

describe('inspection of a malformed response', () => {
  it('reaches the error body when the attestation object cannot be decoded after C4', async () => {
    const browser = new Browser(dev.baseUrl);
    const options = RegisterOptionsResponse.parse(
      await (
        await browser.request('POST', '/api/register/options', { displayName: 'test-user-1' })
      ).json(),
    );
    const credential = new SoftAuthenticator().createCredential({
      challenge: options.challenge,
      origin: TEST_CONFIG.rpOrigin,
      rpId: options.rp.id,
    });
    // Not CBOR: decoding fails lazily, inside the first check that reads authData.
    credential.response.attestationObject = 'AAAA';
    const res = await browser.request('POST', '/api/register/verify', credential);
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error).toBe('malformed_response');
    expect(body.inspection?.authenticatorData).toHaveProperty('error');
    expect(resultOf(body.inspection, 'C4')).toBe('pass');
    expect(body.inspection?.failure).toMatchObject({ check: 'A1', kind: 'malformed' });
  });
});

describe('inspection in production', () => {
  it('is omitted from success and error bodies', async () => {
    const user = await register(prod);
    expect(user.body).not.toHaveProperty('inspection');
    const ok = await login(prod, user);
    expect(await ok.json()).not.toHaveProperty('inspection');
    const rejected = await login(prod, user, { origin: 'https://evil.example' });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).not.toHaveProperty('inspection');
  });
});

describe('inspectCeremony', () => {
  const clientDataJson = JSON.stringify({
    type: 'webauthn.create',
    challenge: 'AAAA',
    origin: TEST_CONFIG.rpOrigin,
  });
  const fakeContext = (authDataGetter: () => never) =>
    ({
      clientData: {
        type: 'webauthn.create',
        challenge: Buffer.from([0, 0, 0]),
        origin: TEST_CONFIG.rpOrigin,
        crossOrigin: false,
        raw: Buffer.from(clientDataJson),
      },
      get authData() {
        return authDataGetter();
      },
      get attestedCredentialData() {
        return authDataGetter();
      },
      expected: {
        type: 'webauthn.create',
        purpose: 'register',
        origin: TEST_CONFIG.rpOrigin,
        rpIdHash: Buffer.alloc(32),
        algorithms: [-7],
        now: new Date(),
      },
    }) as unknown as RegistrationContext;

  it('reports an undecodable attestation instead of throwing', () => {
    const failure = new ParseError('attestationObject is not CBOR');
    const inspection = inspectCeremony({
      ceremony: 'register',
      ctx: fakeContext(() => {
        throw failure;
      }),
      checks: REGISTRATION_CHECKS,
      results: new Map([
        ['C4', 'pass'],
        ['C2', 'pass'],
        ['C5', 'pass'],
        ['C1', 'pass'],
        ['C3', 'pass'],
        ['A1', 'fail'],
      ]),
      config: TEST_CONFIG,
      failure,
    });
    expect(inspection.authenticatorData).toEqual({ error: 'attestationObject is not CBOR' });
    expect(inspection.clientData.json).toBe(clientDataJson);
    expect(inspection.failure).toEqual({
      check: 'A1',
      kind: 'malformed',
      message: 'attestationObject is not CBOR',
    });
    expect(resultOf(inspection, 'A2')).toBe('not_run');
  });

  it('names the check of a failure thrown after every check passed (A4 on save)', () => {
    const failure = new CheckError('A4', 'signCount was updated by a concurrent login');
    const inspection = inspectCeremony({
      ceremony: 'login',
      ctx: fakeContext(() => {
        throw new ParseError('unused');
      }),
      checks: AUTHENTICATION_CHECKS,
      results: new Map(AUTHENTICATION_CHECKS.map((c) => [c.id, 'pass'] as const)),
      config: TEST_CONFIG,
      failure,
    });
    expect(inspection.failure).toEqual({ check: 'A4', kind: 'check', message: failure.message });
  });
});
