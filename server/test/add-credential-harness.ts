import { RegistrationResponse, type RegistrationResponseJSON } from '@app/shared';
import {
  buildAddCredentialContext,
  createAddCredentialOptions,
} from '../src/webauthn/add-credential.js';
import type { RegistrationContext } from '../src/webauthn/checks/types.js';
import { LoginHarness, type RegisteredUser } from './login-harness.js';
import { sessionOf } from './stepup-harness.js';
import { SoftAuthenticator } from './soft-authenticator.js';

/**
 * Adding a passkey to an existing account. Two users are registered through the
 * real pipeline, each with one passkey: the victim and the attacker. Method
 * names differ from RegistrationHarness's, which register() still uses. Sessions
 * are stand-in IDs (`sessionOf(userId)`); the challenge row only stores the ID.
 */
export class AddCredentialHarness extends LoginHarness {
  readonly victim: RegisteredUser = this.register('test-user-1');
  readonly attacker: RegisteredUser = this.register('test-user-2');

  /** Options issued to one of `user`'s sessions (by default "their" session). */
  beginAdd(user: RegisteredUser, sessionId = sessionOf(user.userId)) {
    return createAddCredentialOptions(this.deps, { userId: user.userId, sessionId });
  }

  /** A new authenticator (by default) answers the options. */
  respondAdd(
    options: ReturnType<AddCredentialHarness['beginAdd']>,
    authenticator = new SoftAuthenticator(),
  ): RegistrationResponseJSON {
    return authenticator.createCredential({
      challenge: options.challenge,
      origin: this.deps.config.rpOrigin,
      rpId: this.deps.config.rpId,
    });
  }

  /** Parses the response like the route does, then builds the context. */
  addContext(
    response: RegistrationResponseJSON,
    session: { sessionUserId: string; sessionId: string },
  ): RegistrationContext {
    return buildAddCredentialContext(this.deps, {
      response: RegistrationResponse.parse(response),
      ...session,
    });
  }

  /** The session of `user` as the route would pass it. */
  sessionFor(user: RegisteredUser) {
    return { sessionUserId: user.userId, sessionId: sessionOf(user.userId) };
  }

  credentialCount(userId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?')
      .get(userId) as { n: number };
    return row.n;
  }
}
