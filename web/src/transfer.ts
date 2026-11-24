import { startAuthentication } from '@simplewebauthn/browser';
import {
  StepupOptionsResponse,
  StepupVerifyResponse,
  TransferResponse,
  type TransferRequest,
} from '@app/shared';
import { ApiRequestError, postJson } from './api.js';

const isStepUpRequired = (err: unknown) =>
  err instanceof ApiRequestError && err.body?.error === 'step_up_required';

/**
 * Transfer with step-up (docs/01 §5.3): try the transfer; if the server answers
 * step_up_required, re-authenticate with a passkey for this exact transaction,
 * then send it once more. A second step_up_required is shown, not retried.
 *
 * `onApproved` hears about a successful step-up before the retry, so the
 * ceremony can be shown even if the transfer then fails.
 */
export async function transferWithStepUp(
  tx: TransferRequest,
  hooks: { onStepUp: () => void; onApproved: (stepup: StepupVerifyResponse) => void },
): Promise<TransferResponse> {
  try {
    return await postJson('/api/transfer', tx, TransferResponse);
  } catch (err) {
    if (!isStepUpRequired(err)) throw err;
  }
  hooks.onStepUp();
  const options = await postJson('/api/stepup/options', tx, StepupOptionsResponse);
  const credential = await startAuthentication({ optionsJSON: options });
  hooks.onApproved(await postJson('/api/stepup/verify', credential, StepupVerifyResponse));
  return postJson('/api/transfer', tx, TransferResponse);
}
