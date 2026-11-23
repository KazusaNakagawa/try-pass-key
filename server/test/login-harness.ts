import { AuthenticationResponse } from '@app/shared';
import { buildAuthenticationContext, createLoginOptions } from '../src/webauthn/authentication.js';
import type { AuthenticationContext } from '../src/webauthn/checks/types.js';
import { REGISTRATION_CHECKS, runChecks } from '../src/webauthn/pipeline.js';
import { saveRegistration } from '../src/webauthn/registration.js';
import { RegistrationHarness } from './registration-harness.js';
import { SoftAuthenticator, type AssertionOverrides } from './soft-authenticator.js';

export interface RegisteredUser {
  userId: string;
  userHandle: Buffer;
  authenticator: SoftAuthenticator;
}

/** Registers users through the real pipeline, then runs login ceremonies. */
export class LoginHarness extends RegistrationHarness {
  register(displayName = 'test-user-1', authenticator = new SoftAuthenticator()): RegisteredUser {
    const begun = this.begin(displayName);
    const ctx = this.context(this.respond(begun, {}, authenticator), begun.ceremonyId);
    runChecks(ctx, REGISTRATION_CHECKS);
    const { userId } = saveRegistration(this.deps, ctx, []);
    return { userId, userHandle: Buffer.from(begun.options.user.id, 'base64url'), authenticator };
  }

  beginLogin() {
    return createLoginOptions(this.deps);
  }

  assert(
    begun: ReturnType<LoginHarness['beginLogin']>,
    user: RegisteredUser,
    overrides: AssertionOverrides = {},
    authenticator: SoftAuthenticator = user.authenticator,
  ): AuthenticationResponse {
    return authenticator.getAssertion(
      {
        challenge: begun.options.challenge,
        origin: this.deps.config.rpOrigin,
        rpId: this.deps.config.rpId,
        userHandle: user.userHandle,
      },
      overrides,
    );
  }

  loginContext(
    response: AuthenticationResponse,
    ceremonyId: string | undefined,
  ): AuthenticationContext {
    return buildAuthenticationContext(this.deps, {
      response: AuthenticationResponse.parse(response),
      ceremonyId,
    });
  }

  /** A login context for an already registered user, optionally tampered. */
  validLoginContext(
    user: RegisteredUser,
    overrides: AssertionOverrides = {},
  ): AuthenticationContext {
    const begun = this.beginLogin();
    return this.loginContext(this.assert(begun, user, overrides), begun.ceremonyId);
  }

  setStoredSignCount(user: RegisteredUser, signCount: number): void {
    this.db
      .prepare('UPDATE credentials SET sign_count = ? WHERE user_id = ?')
      .run(signCount, user.userId);
  }
}
