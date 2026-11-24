/**
 * Attack reproduction for the transfer gate (docs/01 §5.3, §6). For every gate
 * check, the full gate rejects the attack and, with only that check removed, the
 * attack is accepted (or, where noted, still rejected by another check).
 * Do not delete or skip these tests.
 */
import { describe, expect, it } from 'vitest';
import {
  CheckError,
  type Check,
  type CheckId,
  type TransferContext,
} from '../src/webauthn/checks/types.js';
import { STEPUP_TTL_MS } from '../src/webauthn/constants.js';
import { runChecks, TRANSFER_GATE_CHECKS } from '../src/webauthn/pipeline.js';
import { TransferHarness } from './transfer-harness.js';

type Checks = readonly Check<TransferContext>[];

const byId = (a: string, b: string) => a.localeCompare(b);
const TX = { to: 'test-account-1', amount: 1000 };

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
      const h = new TransferHarness();
      h.approve(TX);
      runChecks(h.gateContext({ ...TX, amount: 9000 }), checks);
    },
  },
  {
    check: 'S3',
    attack: 'an approval is used 5 minutes and 1 second later',
    rejectedBy: 'S3',
    run: (checks) => {
      const h = new TransferHarness();
      h.approve(TX);
      h.clock = new Date(h.clock.getTime() + STEPUP_TTL_MS + 1000);
      runChecks(h.gateContext(TX), checks);
    },
  },
  {
    check: 'S3',
    attack: 'one approval pays for a second transfer',
    rejectedBy: 'S3',
    run: (checks) => {
      const h = new TransferHarness();
      h.approve(TX);
      runChecks(h.gateContext(TX), checks);
      runChecks(h.gateContext(TX), checks);
    },
  },
  {
    check: 'S3',
    attack: 'a logged-in session transfers without any step-up',
    rejectedBy: 'S3',
    // S2 refuses to compare against a missing approval.
    withoutCheckRejectedBy: 'S2',
    run: (checks) => {
      const h = new TransferHarness();
      runChecks(h.gateContext(TX), checks);
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

describe('transfer gate attacks', () => {
  it('has a scenario for every gate check', () => {
    expect([...new Set(scenarios.map((s) => s.check))].sort(byId)).toEqual(
      TRANSFER_GATE_CHECKS.map((c) => c.id).sort(byId),
    );
  });

  it('lets the approved transfer through within 5 minutes', () => {
    const h = new TransferHarness();
    h.approve(TX);
    h.clock = new Date(h.clock.getTime() + STEPUP_TTL_MS - 1000);
    expect(
      rejection(() => {
        runChecks(h.gateContext(TX), TRANSFER_GATE_CHECKS);
      }),
    ).toBeUndefined();
  });

  describe.each(scenarios)('$check: $attack', (s) => {
    it(`is rejected by ${s.rejectedBy} in the full gate`, () => {
      expect(
        rejection(() => {
          s.run(TRANSFER_GATE_CHECKS);
        }),
      ).toBe(s.rejectedBy);
    });

    const outcome = s.withoutCheckRejectedBy
      ? `is still rejected by ${s.withoutCheckRejectedBy}`
      : 'is accepted';
    it(`${outcome} once ${s.check} is removed`, () => {
      const withoutCheck = TRANSFER_GATE_CHECKS.filter((c) => c.id !== s.check);
      expect(
        rejection(() => {
          s.run(withoutCheck);
        }),
      ).toBe(s.withoutCheckRejectedBy);
    });
  });
});
