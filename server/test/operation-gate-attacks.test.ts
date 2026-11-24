/**
 * Attack reproduction for the operation gate (docs/01 §5.3, §5.4, §6): the
 * step-up approval in front of a transfer, adding a passkey and deleting one. For every gate
 * check, the full gate rejects the attack and, with only that check removed, the
 * attack is accepted (or, where noted, still rejected by another check).
 * Do not delete or skip these tests.
 */
import { describe, expect, it } from 'vitest';
import {
  CheckError,
  type Check,
  type CheckId,
  type OperationGateContext,
} from '../src/webauthn/checks/types.js';
import { STEPUP_TTL_MS } from '../src/webauthn/constants.js';
import { OPERATION_GATE_CHECKS, runChecks } from '../src/webauthn/pipeline.js';
import { OperationGateHarness } from './operation-gate-harness.js';

type Checks = readonly Check<OperationGateContext>[];

const byId = (a: string, b: string) => a.localeCompare(b);
const TX = { kind: 'transfer', to: 'test-account-1', amount: 1000 } as const;
const ADD = { kind: 'add_credential' } as const;
const deleteOf = (credentialId: string) => ({ kind: 'delete_credential', credentialId }) as const;

interface Scenario {
  check: CheckId;
  attack: string;
  rejectedBy: CheckId;
  withoutCheckRejectedBy?: CheckId;
  run(checks: Checks): void;
}

const scenarios: Scenario[] = [
  {
    check: 'S2',
    attack: 'the amount is changed after the step-up approved 1,000',
    rejectedBy: 'S2',
    run: (checks) => {
      const h = new OperationGateHarness();
      h.approve(TX);
      runChecks(h.context({ ...TX, amount: 9000 }), checks);
    },
  },
  {
    check: 'S3',
    attack: 'an approval is used 5 minutes and 1 second later',
    rejectedBy: 'S3',
    run: (checks) => {
      const h = new OperationGateHarness();
      h.approve(TX);
      h.clock = new Date(h.clock.getTime() + STEPUP_TTL_MS + 1000);
      runChecks(h.context(TX), checks);
    },
  },
  {
    check: 'S3',
    attack: 'one approval pays for a second transfer',
    rejectedBy: 'S3',
    run: (checks) => {
      const h = new OperationGateHarness();
      h.approve(TX);
      runChecks(h.context(TX), checks);
      runChecks(h.context(TX), checks);
    },
  },
  {
    check: 'S3',
    attack: 'a logged-in session transfers without any step-up',
    rejectedBy: 'S3',
    // S2 refuses to compare against a missing approval.
    withoutCheckRejectedBy: 'S2',
    run: (checks) => {
      const h = new OperationGateHarness();
      runChecks(h.context(TX), checks);
    },
  },
  {
    check: 'S2',
    attack: 'a transfer approval is used to delete a passkey',
    rejectedBy: 'S2',
    run: (checks) => {
      const h = new OperationGateHarness();
      h.approve(TX);
      runChecks(h.context(deleteOf('AAAA')), checks);
    },
  },
  {
    check: 'S2',
    attack: 'the approval to delete passkey X is used to delete passkey Y',
    rejectedBy: 'S2',
    run: (checks) => {
      const h = new OperationGateHarness();
      h.approve(deleteOf('AAAA'));
      runChecks(h.context(deleteOf('BBBB')), checks);
    },
  },
  {
    check: 'S3',
    attack: 'one approval to add a passkey adds a second one',
    rejectedBy: 'S3',
    run: (checks) => {
      const h = new OperationGateHarness();
      h.approve(ADD);
      runChecks(h.context(ADD), checks);
      runChecks(h.context(ADD), checks);
    },
  },
  {
    check: 'S3',
    attack: 'a logged-in session adds a passkey without any step-up',
    rejectedBy: 'S3',
    // S2 refuses to compare against a missing approval.
    withoutCheckRejectedBy: 'S2',
    run: (checks) => {
      const h = new OperationGateHarness();
      runChecks(h.context(ADD), checks);
    },
  },
];

function rejection(run: () => void): CheckId | undefined {
  try {
    run();
    return undefined;
  } catch (err) {
    if (err instanceof CheckError) return err.check;
    throw err;
  }
}

describe('operation gate attacks', () => {
  it('has a scenario for every gate check', () => {
    expect([...new Set(scenarios.map((s) => s.check))].sort(byId)).toEqual(
      OPERATION_GATE_CHECKS.map((c) => c.id).sort(byId),
    );
  });

  it('lets the approved transfer through within 5 minutes', () => {
    const h = new OperationGateHarness();
    h.approve(TX);
    h.clock = new Date(h.clock.getTime() + STEPUP_TTL_MS - 1000);
    expect(
      rejection(() => {
        runChecks(h.context(TX), OPERATION_GATE_CHECKS);
      }),
    ).toBeUndefined();
  });

  it.each([
    ['adding a passkey', ADD],
    ['deleting that passkey', deleteOf('AAAA')],
  ] as const)('lets an approval for %s through', (_name, op) => {
    const h = new OperationGateHarness();
    h.approve(op);
    expect(
      rejection(() => {
        runChecks(h.context(op), OPERATION_GATE_CHECKS);
      }),
    ).toBeUndefined();
  });

  describe.each(scenarios)('$check: $attack', (s) => {
    it(`is rejected by ${s.rejectedBy} in the full gate`, () => {
      expect(
        rejection(() => {
          s.run(OPERATION_GATE_CHECKS);
        }),
      ).toBe(s.rejectedBy);
    });

    const outcome = s.withoutCheckRejectedBy
      ? `is still rejected by ${s.withoutCheckRejectedBy}`
      : 'is accepted';
    it(`${outcome} once ${s.check} is removed`, () => {
      const withoutCheck = OPERATION_GATE_CHECKS.filter((c) => c.id !== s.check);
      expect(
        rejection(() => {
          s.run(withoutCheck);
        }),
      ).toBe(s.withoutCheckRejectedBy);
    });
  });
});
