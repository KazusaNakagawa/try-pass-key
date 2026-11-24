import { createHash } from 'node:crypto';
import type { StepupOperation } from '@app/shared';

/**
 * What a step-up approval is bound to (docs/01 §5.3, S2). The object is rebuilt
 * with a fixed key order per kind, so the hash does not depend on how the request
 * body was written. `kind` keeps an approval for one kind of operation from being
 * accepted for another; a transfer hashes exactly as it did in M6.
 */
export function operationHash(op: StepupOperation): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(op)))
    .digest('base64url');
}

function canonical(op: StepupOperation): object {
  switch (op.kind) {
    case 'transfer':
      return { kind: op.kind, to: op.to, amount: op.amount };
    case 'add_credential':
      return { kind: op.kind };
    case 'delete_credential':
      return { kind: op.kind, credentialId: op.credentialId };
  }
}
