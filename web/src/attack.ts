import { TransferResponse } from '@app/shared';
import { postJson } from './api.js';
import { emitStage, emitStageFailed } from './stage.js';
import { isStepUpRequired } from './stepup.js';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Episode 4 for real (docs/05): the page plays the thief. It holds the session
 * cookie (the browser sends it), but has no passkey signature, so it sends a
 * transfer with no step-up approval. The server must refuse with step_up_required.
 * Nothing here weakens a server check: it is an ordinary request.
 */
export async function runStolenCookieAttack(): Promise<{ blocked: boolean; detail: string }> {
  const tx = { to: 'test-attacker-account', amount: 1_000_000 };
  emitStage('attack:stolen-cookie');
  await sleep(1500);
  emitStage('attack:transfer');
  try {
    const result = await postJson('/api/transfer', tx, TransferResponse);
    // Never expected: the server let a transfer through without a step-up.
    emitStageFailed();
    return {
      blocked: false,
      detail: `想定外: 送金が通りました\n${JSON.stringify(result, null, 2)}`,
    };
  } catch (err) {
    if (!isStepUpRequired(err)) {
      emitStageFailed();
      return {
        blocked: false,
        detail: `想定外のエラー: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    emitStage('attack:stepup-required');
    await sleep(1500);
    emitStage('attack:blocked');
    return {
      blocked: true,
      detail: `ブロックされました（401 step_up_required）\n${err instanceof Error ? err.message : ''}`,
    };
  }
}
