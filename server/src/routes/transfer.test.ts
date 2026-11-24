import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, TransferResponse, TransfersResponse } from '@app/shared';
import { registerUser, stepUp } from '../../test/api-helpers.js';
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

async function expectStepUpRequired(res: Response, check: 'S2' | 'S3') {
  expect(res.status).toBe(401);
  expect(ApiError.parse(await res.json())).toMatchObject({ error: 'step_up_required', check });
}

describe('POST /api/transfer', () => {
  it('requires a session', async () => {
    const res = await new Browser(server.baseUrl).request('POST', '/api/transfer', TX);
    expect(res.status).toBe(401);
    expect(ApiError.parse(await res.json()).error).toBe('unauthenticated');
  });

  it('is refused without a step-up even when logged in', async () => {
    const user = await registerUser(server.baseUrl);
    await expectStepUpRequired(await user.browser.request('POST', '/api/transfer', TX), 'S3');
  });

  it('moves money after the step-up approved this transfer', async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, OP);
    const res = await user.browser.request('POST', '/api/transfer', TX);
    expect(res.status).toBe(200);
    expect(TransferResponse.parse(await res.json()).balance).toBe(99_000);
    const list = TransfersResponse.parse(
      await (await user.browser.request('GET', '/api/transfers')).json(),
    );
    expect(list.balance).toBe(99_000);
    expect(list.transfers).toMatchObject([{ to: 'test-account-1', amount: 1000 }]);
  });

  it('refuses a transfer changed after the approval (S2)', async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, OP);
    const res = await user.browser.request('POST', '/api/transfer', { ...TX, amount: 9000 });
    await expectStepUpRequired(res, 'S2');
  });

  it('refuses an approval older than 5 minutes (S3)', async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, OP);
    const old = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    server.db.prepare('UPDATE sessions SET stepup_at = ? WHERE user_id = ?').run(old, user.userId);
    await expectStepUpRequired(await user.browser.request('POST', '/api/transfer', TX), 'S3');
  });

  it('refuses a second transfer on one approval (S3)', async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, OP);
    expect((await user.browser.request('POST', '/api/transfer', TX)).status).toBe(200);
    await expectStepUpRequired(await user.browser.request('POST', '/api/transfer', TX), 'S3');
  });

  it("does not let the same user's other session use the approval", async () => {
    const user = await registerUser(server.baseUrl);
    // A second browser of the same user (another device, or a stolen cookie).
    const other = new Browser(server.baseUrl);
    const { token } = createSession(
      server.db,
      { id: user.userId, displayName: 'test-user-1' },
      new Date(),
    );
    other.cookies.set('session', token);
    await stepUp(user, OP);
    await expectStepUpRequired(await other.request('POST', '/api/transfer', TX), 'S3');
    expect((await user.browser.request('POST', '/api/transfer', TX)).status).toBe(200);
  });

  it('does not let another browser use the approval', async () => {
    const user = await registerUser(server.baseUrl, 'test-user-1');
    const other = await registerUser(server.baseUrl, 'test-user-2');
    await stepUp(user, OP);
    await expectStepUpRequired(await other.browser.request('POST', '/api/transfer', TX), 'S3');
    expect((await user.browser.request('POST', '/api/transfer', TX)).status).toBe(200);
  });

  it('rejects a malformed request without using the approval', async () => {
    const user = await registerUser(server.baseUrl);
    await stepUp(user, OP);
    const bad = await user.browser.request('POST', '/api/transfer', { to: '  ', amount: 0 });
    expect(bad.status).toBe(400);
    expect(ApiError.parse(await bad.json()).error).toBe('invalid_request');
    expect((await user.browser.request('POST', '/api/transfer', TX)).status).toBe(200);
  });
});
