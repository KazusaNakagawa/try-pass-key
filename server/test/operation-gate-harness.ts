import type { DatabaseSync } from 'node:sqlite';
import type { StepupOperation } from '@app/shared';
import { openDb } from '../src/db.js';
import { buildOperationGateContext } from '../src/operations/gate.js';
import { operationHash } from '../src/operations/operation-hash.js';
import { createSession, rotateSession } from '../src/session/sessions.js';
import type { OperationGateContext } from '../src/webauthn/checks/types.js';
import { INITIAL_BALANCE } from '../src/webauthn/constants.js';

/** One user with one session; approvals are recorded the way a step-up does. */
export class OperationGateHarness {
  readonly db: DatabaseSync = openDb(':memory:');
  clock = new Date('2026-01-01T00:00:00Z');
  readonly deps = { db: this.db, now: () => this.clock };
  readonly userId = 'u1';
  private token: string;

  constructor() {
    this.db
      .prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)')
      .run(this.userId, Buffer.from([1]), 'test-user-1', INITIAL_BALANCE, this.clock.toISOString());
    this.token = createSession(
      this.db,
      { id: this.userId, displayName: 'test-user-1' },
      this.clock,
    ).token;
  }

  get sessionId(): string {
    const row = this.db.prepare('SELECT id FROM sessions').get() as { id: string };
    return row.id;
  }

  /** Records a step-up approval for `op` at the current clock (rotates the session). */
  approve(op: StepupOperation): void {
    const rotated = rotateSession(this.db, this.token, this.clock, { txHash: operationHash(op) });
    if (!rotated) throw new Error('session is gone');
    this.token = rotated.token;
  }

  /** The production context. */
  context(op: StepupOperation): OperationGateContext {
    return buildOperationGateContext(this.deps, { sessionId: this.sessionId, op });
  }
}
