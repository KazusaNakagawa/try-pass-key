import { AuthenticationResponse, type StepupOperation, type TransferRequest } from '@app/shared';
import { operationHash } from '../src/operations/operation-hash.js';
import type { StepupContext } from '../src/webauthn/checks/types.js';
import { buildStepupContext, createStepupOptions } from '../src/webauthn/stepup.js';
import { LoginHarness, type RegisteredUser } from './login-harness.js';
import type { AssertionOverrides, SoftAuthenticator } from './soft-authenticator.js';

export const TX: TransferRequest = { to: 'test-account-1', amount: 1000 };
/** TX as the operation a step-up approves. */
export const TRANSFER_OP: StepupOperation = { kind: 'transfer', ...TX };

/** Stand-in session ID (the hash of a session token) for a user's usual session. */
export const sessionOf = (userId: string) => `session-of-${userId}`;

/** Step-up ceremonies for users registered through the real pipeline. */
export class StepupHarness extends LoginHarness {
  /** Options issued to one of `user`'s sessions (by default "their" session) for `op`. */
  beginStepup(
    user: RegisteredUser,
    op: StepupOperation = TRANSFER_OP,
    sessionId = sessionOf(user.userId),
  ) {
    return createStepupOptions(this.deps, {
      userId: user.userId,
      sessionId,
      txHash: operationHash(op),
    });
  }

  stepupResponse(
    options: ReturnType<StepupHarness['beginStepup']>,
    signer: RegisteredUser,
    overrides: AssertionOverrides = {},
    authenticator: SoftAuthenticator = signer.authenticator,
  ): AuthenticationResponse {
    return authenticator.getAssertion(
      {
        challenge: options.challenge,
        origin: this.deps.config.rpOrigin,
        rpId: this.deps.config.rpId,
        userHandle: signer.userHandle,
      },
      overrides,
    );
  }

  /** The response submitted in session `sessionId` of `sessionUserId`. */
  stepupContext(
    response: AuthenticationResponse,
    sessionUserId: string,
    sessionId = sessionOf(sessionUserId),
  ): StepupContext {
    return buildStepupContext(this.deps, {
      response: AuthenticationResponse.parse(response),
      sessionUserId,
      sessionId,
    });
  }

  /** `signer` answers a step-up started in `sessionUser`'s session. */
  validStepupContext(
    sessionUser: RegisteredUser,
    overrides: AssertionOverrides = {},
    signer: RegisteredUser = sessionUser,
  ): StepupContext {
    const options = this.beginStepup(sessionUser);
    return this.stepupContext(this.stepupResponse(options, signer, overrides), sessionUser.userId);
  }
}
