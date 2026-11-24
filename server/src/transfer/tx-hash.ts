import { createHash } from 'node:crypto';

/**
 * What a step-up approval is bound to (docs/01 §5.3, S2). The object is rebuilt
 * with a fixed key order, so the hash does not depend on how the request body
 * was written. `kind` keeps an approval for one kind of operation from being
 * accepted for another (M7 adds credential deletion).
 */
export function transferTxHash(tx: { to: string; amount: number }): string {
  const canonical = JSON.stringify({ kind: 'transfer', to: tx.to, amount: tx.amount });
  return createHash('sha256').update(canonical).digest('base64url');
}
