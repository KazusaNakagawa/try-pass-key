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
 */
export async function transferWithStepUp(
  tx: TransferRequest,
  onStepUp: () => void,
): Promise<{ result: TransferResponse; stepup?: StepupVerifyResponse }> {
  try {
    return { result: await postJson('/api/transfer', tx, TransferResponse) };
  } catch (err) {
    if (!isStepUpRequired(err)) throw err;
  }
  onStepUp();
  const options = await postJson('/api/stepup/options', tx, StepupOptionsResponse);
  const credential = await startAuthentication({ optionsJSON: options });
  const stepup = await postJson('/api/stepup/verify', credential, StepupVerifyResponse);
  return { result: await postJson('/api/transfer', tx, TransferResponse), stepup };
}
