import type { DatabaseSync } from 'node:sqlite';
import type { StepupOperation } from '@app/shared';
import type { OperationGateContext, StepupApproval } from '../webauthn/checks/types.js';
import { operationHash } from './operation-hash.js';

export interface OperationGateDeps {
  db: DatabaseSync;
  now: () => Date;
}

/**
 * What the operation gate (OPERATION_GATE_CHECKS) checks for one request: a
 * transfer, adding a passkey or deleting one. The approval is read here; S3
 * consumes it only if it is still the value read.
 */
export function buildOperationGateContext(
  deps: OperationGateDeps,
  input: { sessionId: string; op: StepupOperation },
): OperationGateContext {
  const approval = readApproval(deps.db, input.sessionId);
  return {
    txHash: operationHash(input.op),
    now: deps.now(),
    approval,
    consumeApproval: () =>
      approval !== undefined && clearApproval(deps.db, input.sessionId, approval.approvedTxHash),
  };
}

function readApproval(db: DatabaseSync, sessionId: string): StepupApproval | undefined {
  const row = db
    .prepare('SELECT stepup_at, approved_tx_hash FROM sessions WHERE id = ?')
    .get(sessionId) as { stepup_at: string | null; approved_tx_hash: string | null } | undefined;
  // Without a time, S3 could not tell its age: treat it as no approval at all.
  if (!row?.approved_tx_hash || !row.stepup_at) return undefined;
  return { stepupAt: row.stepup_at, approvedTxHash: row.approved_tx_hash };
}

/**
 * Clears the approval only if it is still the value read: of two concurrent
 * requests, only the one whose UPDATE changes the row may use it.
 * (UPDATE ... RETURNING would return the cleared NULL, not the approval.)
 */
function clearApproval(db: DatabaseSync, sessionId: string, approvedTxHash: string): boolean {
  const result = db
    .prepare('UPDATE sessions SET approved_tx_hash = NULL WHERE id = ? AND approved_tx_hash = ?')
    .run(sessionId, approvedTxHash);
  return Number(result.changes) === 1;
}
