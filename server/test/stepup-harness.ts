import { AuthenticationResponse, type TransferRequest } from '@app/shared';
import { transferTxHash } from '../src/transfer/tx-hash.js';
import type { StepupContext } from '../src/webauthn/checks/types.js';
import { buildStepupContext, createStepupOptions } from '../src/webauthn/stepup.js';
import { LoginHarness, type RegisteredUser } from './login-harness.js';
import type { AssertionOverrides, SoftAuthenticator } from './soft-authenticator.js';

export const TX: TransferRequest = { to: 'test-account-1', amount: 1000 };

/** Step-up ceremonies for users registered through the real pipeline. */
export class StepupHarness extends LoginHarness {
  /** Options issued to `user`'s session for `tx`. */
  beginStepup(user: RegisteredUser, tx: TransferRequest = TX) {
    return createStepupOptions(this.deps, { userId: user.userId, txHash: transferTxHash(tx) });
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

  stepupContext(response: AuthenticationResponse, sessionUserId: string): StepupContext {
    return buildStepupContext(this.deps, {
      response: AuthenticationResponse.parse(response),
      sessionUserId,
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
