import { TransferResponse, type StepupVerifyResponse, type TransferRequest } from '@app/shared';
import { postJson } from './api.js';
import { isStepUpRequired, stepUpFor } from './stepup.js';

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
  hooks.onApproved(await stepUpFor({ kind: 'transfer', ...tx }));
  return postJson('/api/transfer', tx, TransferResponse);
}
