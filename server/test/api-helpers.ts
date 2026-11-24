import {
  RegisterOptionsResponse,
  RegisterVerifyResponse,
  StepupOptionsResponse,
  type StepupOperation,
} from '@app/shared';
import { TEST_CONFIG } from './registration-harness.js';
import { SoftAuthenticator, type AssertionOverrides } from './soft-authenticator.js';
import { Browser } from './test-server.js';

export interface ApiUser {
  browser: Browser;
  authenticator: SoftAuthenticator;
  userId: string;
  userHandle: Buffer;
}

/** Registers through the API; the returned browser is logged in. */
export async function registerUser(baseUrl: string, displayName = 'test-user-1'): Promise<ApiUser> {
  const browser = new Browser(baseUrl);
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

/**
 * Runs /api/stepup/options and /api/stepup/verify for `op` in `user`'s browser,
 * signed by `signer`.
 */
export async function stepUp(
  user: ApiUser,
  op: StepupOperation,
  overrides: AssertionOverrides = {},
  signer: ApiUser = user,
): Promise<Response> {
  const options = StepupOptionsResponse.parse(
    await (await user.browser.request('POST', '/api/stepup/options', op)).json(),
  );
  return user.browser.request(
    'POST',
    '/api/stepup/verify',
    signer.authenticator.getAssertion(
      {
        challenge: options.challenge,
        origin: TEST_CONFIG.rpOrigin,
        rpId: options.rpId,
        userHandle: signer.userHandle,
      },
      overrides,
    ),
  );
}
