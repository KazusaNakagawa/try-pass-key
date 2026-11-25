import { startAuthentication } from '@simplewebauthn/browser';
import { StepupOptionsResponse, StepupVerifyResponse, type StepupOperation } from '@app/shared';
import { ApiRequestError, postJson } from './api.js';
import { emitStage } from './stage.js';

export const isStepUpRequired = (err: unknown) =>
  err instanceof ApiRequestError && err.body?.error === 'step_up_required';

/**
 * Re-authenticates with a passkey to approve this exact operation (docs/01
 * §5.3, §5.4). The server records the approval on the session: 5 minutes, once.
 */
export async function stepUpFor(op: StepupOperation): Promise<StepupVerifyResponse> {
  const options = await postJson('/api/stepup/options', op, StepupOptionsResponse);
  emitStage('stepup:authenticator');
  const credential = await startAuthentication({ optionsJSON: options });
  return postJson('/api/stepup/verify', credential, StepupVerifyResponse);
}
