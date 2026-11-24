import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, RegisterOptionsResponse, RegisterVerifyResponse } from '@app/shared';
import { SoftAuthenticator } from '../../test/soft-authenticator.js';
import { TEST_CONFIG } from '../../test/registration-harness.js';
import { createApp } from '../app.js';
import { openDb } from '../db.js';

const db = openDb(':memory:');
let baseUrl: string;
let close: () => void;

beforeAll(async () => {
  const app = createApp({ db, config: TEST_CONFIG });
  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      close = () => {
        server.close();
      };
      resolve();
    });
  });
});
afterAll(() => {
  close();
});

async function post(
  path: string,
  body: unknown,
  opts: { cookie?: string; origin?: string | null } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const origin = opts.origin === undefined ? TEST_CONFIG.rpOrigin : opts.origin;
  if (origin !== null) headers.origin = origin;
  if (opts.cookie) headers.cookie = opts.cookie;
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

/** Browser side of /api/register/options: returns the options and the cookie to send back. */
async function begin(displayName = 'test-user-1') {
  const res = await post('/api/register/options', { displayName });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('set-cookie') ?? '';
  return {
    options: RegisterOptionsResponse.parse(await res.json()),
    setCookie,
    cookie: setCookie.split(';')[0] ?? '',
  };
}

function respond(options: RegisterOptionsResponse, overrides = {}) {
  return new SoftAuthenticator().createCredential(
    { challenge: options.challenge, origin: TEST_CONFIG.rpOrigin, rpId: options.rp.id },
    overrides,
  );
}

describe('POST /api/register/options', () => {
  it('returns passkey creation options and a ceremony cookie', async () => {
    const { options, setCookie } = await begin();
    expect(options.rp.id).toBe('localhost');
    expect(options.authenticatorSelection).toEqual({
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    });
    expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
    expect(Buffer.from(options.challenge, 'base64url')).toHaveLength(32);
    expect(setCookie).toMatch(/^ceremony=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Path=\/api/);
  });

  it('rejects an empty display name', async () => {
    const res = await post('/api/register/options', { displayName: '  ' });
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error).toBe('invalid_request');
  });

  it('rejects a request without the RP Origin header (CSRF)', async () => {
    const res = await post(
      '/api/register/options',
      { displayName: 'x' },
      { origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(ApiError.parse(await res.json()).error).toBe('invalid_request_origin');
  });
});

describe('POST /api/register/verify', () => {
  it('creates the user and stores the public key', async () => {
    const { options, cookie } = await begin('test-user-2');
    const res = await post('/api/register/verify', respond(options), { cookie });
    expect(res.status).toBe(200);
    const body = RegisterVerifyResponse.parse(await res.json());
    expect(body.displayName).toBe('test-user-2');
    expect(body.credential).toMatchObject({ alg: -7, backupEligible: true, backupState: true });
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(body.userId) as
      { balance: number } | undefined;
    expect(user?.balance).toBe(100000);

    const row = db
      .prepare('SELECT user_id, length(public_key) AS keyLength FROM credentials WHERE user_id = ?')
      .get(body.userId) as { user_id: string; keyLength: number } | undefined;
    expect(row?.keyLength).toBeGreaterThan(0);
    // This ceremony's challenge row is gone (C4).
    const challenge = Buffer.from(options.challenge, 'base64url');
    expect(
      db.prepare('SELECT count(*) AS n FROM challenges WHERE challenge = ?').get(challenge),
    ).toEqual({
      n: 0,
    });
  });

  it('reports which check rejected the response', async () => {
    const { options, cookie } = await begin();
    const res = await post(
      '/api/register/verify',
      respond(options, { origin: 'https://evil.example' }),
      {
        cookie,
      },
    );
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json())).toMatchObject({
      error: 'invalid_origin',
      check: 'C3',
    });
  });

  it('rejects a response without the ceremony cookie (C5)', async () => {
    const { options } = await begin();
    const res = await post('/api/register/verify', respond(options));
    expect(ApiError.parse(await res.json())).toMatchObject({ check: 'C5' });
  });

  it('rejects an undecodable response as malformed', async () => {
    const { options, cookie } = await begin();
    const response = respond(options);
    response.response.attestationObject = 'AAAA';
    const res = await post('/api/register/verify', response, { cookie });
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error).toBe('malformed_response');
  });

  it('consumes the challenge even when the attestation cannot be decoded (C4 first)', async () => {
    const { options, cookie } = await begin();
    const response = respond(options);
    response.response.attestationObject = 'AAAA';
    await post('/api/register/verify', response, { cookie });
    const challenge = Buffer.from(options.challenge, 'base64url');
    expect(
      db.prepare('SELECT count(*) AS n FROM challenges WHERE challenge = ?').get(challenge),
    ).toEqual({ n: 0 });
  });

  it('treats a malformed ceremony cookie as missing instead of failing with 500', async () => {
    const { options } = await begin();
    const res = await post('/api/register/verify', respond(options), {
      cookie: 'ceremony=%E0%A4%A',
    });
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json())).toMatchObject({ check: 'C5' });
  });

  it('stores only known transports', async () => {
    const { options, cookie } = await begin();
    const response = respond(options);
    response.response.transports = ['internal', 'x'.repeat(20), 'hybrid'];
    const res = await post('/api/register/verify', response, { cookie });
    const body = RegisterVerifyResponse.parse(await res.json());
    expect(body.credential.transports).toEqual(['internal', 'hybrid']);
  });
});

describe('request body errors', () => {
  it('answers 413, not 500, for a body over the size limit', async () => {
    const res = await post('/api/register/options', { displayName: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
    expect(ApiError.parse(await res.json()).error).toBe('payload_too_large');
  });

  it('answers 400 for malformed JSON', async () => {
    const res = await fetch(`${baseUrl}/api/register/options`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_CONFIG.rpOrigin },
      body: '{',
    });
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error).toBe('invalid_request');
  });
});
