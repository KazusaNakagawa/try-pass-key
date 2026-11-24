import {
  LoginOptionsResponse,
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

/** Asks for add-passkey options in `user`'s browser. */
export async function addCredentialOptions(user: ApiUser) {
  const res = await user.browser.request('POST', '/api/credentials/options');
  return RegisterOptionsResponse.parse(await res.json());
}

/**
 * Answers add-passkey options with `authenticator` and submits the response from
 * `submitter`'s browser (by default the user's own).
 */
export function submitAddCredential(
  submitter: ApiUser,
  options: RegisterOptionsResponse,
  authenticator: SoftAuthenticator,
): Promise<Response> {
  return submitter.browser.request(
    'POST',
    '/api/credentials/verify',
    authenticator.createCredential({
      challenge: options.challenge,
      origin: TEST_CONFIG.rpOrigin,
      rpId: options.rp.id,
    }),
  );
}

/** Options, then verify, in `user`'s browser. Does not step up. */
export async function addCredential(
  user: ApiUser,
  authenticator = new SoftAuthenticator(),
): Promise<Response> {
  return submitAddCredential(user, await addCredentialOptions(user), authenticator);
}

/** Logs in from a fresh browser with `authenticator`, a passkey of the user `userHandle` names. */
export async function loginWith(
  baseUrl: string,
  authenticator: SoftAuthenticator,
  userHandle: Buffer,
): Promise<{ browser: Browser; res: Response }> {
  const browser = new Browser(baseUrl);
  const options = LoginOptionsResponse.parse(
    await (await browser.request('POST', '/api/login/options')).json(),
  );
  const res = await browser.request(
    'POST',
    '/api/login/verify',
    authenticator.getAssertion({
      challenge: options.challenge,
      origin: TEST_CONFIG.rpOrigin,
      rpId: options.rpId,
      userHandle,
    }),
  );
  return { browser, res };
}
