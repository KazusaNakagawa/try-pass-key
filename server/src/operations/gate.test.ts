import { describe, expect, it } from 'vitest';
import { OperationGateHarness } from '../../test/operation-gate-harness.js';
import { STEPUP_TTL_MS } from '../webauthn/constants.js';
import { approvalTimeLeft } from './gate.js';

const ADD = { kind: 'add_credential' } as const;

describe('approvalTimeLeft', () => {
  it('is the rest of the 5 minutes for an approval of this operation', () => {
    const h = new OperationGateHarness();
    h.approve(ADD);
    h.clock = new Date(h.clock.getTime() + 60_000);
    expect(approvalTimeLeft(h.deps, { sessionId: h.sessionId, op: ADD })).toBe(
      STEPUP_TTL_MS - 60_000,
    );
  });

  it('is 0 without an approval, or for an approval of another operation', () => {
    const h = new OperationGateHarness();
    expect(approvalTimeLeft(h.deps, { sessionId: h.sessionId, op: ADD })).toBe(0);
    h.approve({ kind: 'transfer', to: 'test-account-1', amount: 1000 });
    expect(approvalTimeLeft(h.deps, { sessionId: h.sessionId, op: ADD })).toBe(0);
  });

  it('is 0 once the approval has expired, and does not consume it', () => {
    const h = new OperationGateHarness();
    h.approve(ADD);
    expect(approvalTimeLeft(h.deps, { sessionId: h.sessionId, op: ADD })).toBe(STEPUP_TTL_MS);
    expect(h.context(ADD).approval).toBeDefined();
    h.clock = new Date(h.clock.getTime() + STEPUP_TTL_MS);
    expect(approvalTimeLeft(h.deps, { sessionId: h.sessionId, op: ADD })).toBe(0);
  });
});
