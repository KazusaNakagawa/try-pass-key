/**
 * Attack reproduction for step-up (docs/01 §5.3, §6). For every step-up check:
 *   1. the full pipeline rejects the attack, and
 *   2. with only that check removed, the attack is accepted
 *      (or, where noted, still rejected by another check: defense in depth).
 * Do not delete or skip these tests.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { transferTxHash } from '../src/transfer/tx-hash.js';
import {
  CheckError,
  type Check,
  type CheckId,
  type StepupContext,
} from '../src/webauthn/checks/types.js';
import { runChecks, STEPUP_CHECKS } from '../src/webauthn/pipeline.js';
import { saveStepup } from '../src/webauthn/stepup.js';
import { SoftAuthenticator, type AssertionOverrides } from './soft-authenticator.js';
import { StepupHarness, TX } from './stepup-harness.js';

type Checks = readonly Check<StepupContext>[];

const byId = (a: string, b: string) => a.localeCompare(b);

interface Scenario {
  check: CheckId;
  attack: string;
  rejectedBy: CheckId;
  /** undefined: accepted once the check is removed. Otherwise the check that still rejects it. */
  withoutCheckRejectedBy?: CheckId;
  run(checks: Checks): void;
}

/** One registered user stepping up in their own session, with tampered fields. */
function simple(check: CheckId, attack: string, overrides: AssertionOverrides): Scenario {
  return {
    check,
    attack,
    rejectedBy: check,
    run: (checks) => {
      const h = new StepupHarness();
      runChecks(h.validStepupContext(h.register(), overrides), checks);
    },
  };
}

const scenarios: Scenario[] = [
  simple('C1', 'a registration (webauthn.create) response is used to approve', {
    type: 'webauthn.create',
  }),
  {
    check: 'C2',
    attack: 'a response to an expired step-up challenge is submitted',
    rejectedBy: 'C2',
    run: (checks) => {
      const h = new StepupHarness();
      const user = h.register();
      const options = h.beginStepup(user);
      h.clock = new Date(h.clock.getTime() + 10 * 60 * 1000);
      runChecks(h.stepupContext(h.stepupResponse(options, user), user.userId), checks);
    },
  },
  simple('C3', 'a response created on a phishing origin is relayed', {
    origin: 'https://evil.example',
  }),
  {
    check: 'C4',
    attack: 'a captured step-up response is replayed',
    rejectedBy: 'C2',
    run: (checks) => {
      const h = new StepupHarness();
      const user = h.register();
      const response = h.stepupResponse(h.beginStepup(user), user);
      runChecks(h.stepupContext(response, user.userId), checks);
      runChecks(h.stepupContext(response, user.userId), checks);
    },
  },
  {
    check: 'C5',
    attack: "the victim's leaked step-up response is submitted in the attacker's session",
    rejectedBy: 'C5',
    // The credential is the victim's, not the session user's.
    withoutCheckRejectedBy: 'S1',
    run: (checks) => {
      const h = new StepupHarness();
      const victim = h.register('test-user-1');
      const attacker = h.register('test-user-2');
      const response = h.stepupResponse(h.beginStepup(victim), victim);
      runChecks(h.stepupContext(response, attacker.userId), checks);
    },
  },
  simple('A1', 'a signature from a credential scoped to another RP ID', { rpId: 'evil.example' }),
  simple('A2', 'the authenticator signs with nobody present (UP=0)', { flags: { up: false } }),
  simple('A3', 'approval without biometrics or PIN (UV=0)', { flags: { uv: false } }),
  {
    check: 'L1',
    attack: 'a key that was never registered is used',
    rejectedBy: 'L1',
    // S1 and L3 need the stored credential, so they still reject it.
    withoutCheckRejectedBy: 'S1',
    run: (checks) => {
      const h = new StepupHarness();
      runChecks(h.validStepupContext(h.register(), { credentialId: randomBytes(16) }), checks);
    },
  },
  {
    check: 'S1',
    attack: 'with a stolen session, the attacker approves with their own passkey',
    rejectedBy: 'S1',
    run: (checks) => {
      const h = new StepupHarness();
      const victim = h.register('test-user-1');
      const attacker = h.register('test-user-2');
      runChecks(h.validStepupContext(victim, { userHandle: null }, attacker), checks);
    },
  },
  {
    check: 'L3',
    attack: 'the signature is forged with a key the attacker controls',
    rejectedBy: 'L3',
    run: (checks) => {
      const h = new StepupHarness();
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      runChecks(h.validStepupContext(h.register(), { signWith: privateKey }), checks);
    },
  },
  {
    check: 'L4',
    attack: 'a device-bound credential (BE=0) reports itself as synced (BE=1, BS=1)',
    rejectedBy: 'L4',
    run: (checks) => {
      const h = new StepupHarness();
      const deviceBound = new SoftAuthenticator({ flags: { be: false, bs: false } });
      const user = h.register('test-user-1', deviceBound);
      runChecks(h.validStepupContext(user, { flags: { be: true, bs: true } }), checks);
    },
  },
  {
    check: 'A4',
    attack: 'a cloned authenticator reuses a signCount that was already seen',
    rejectedBy: 'A4',
    run: (checks) => {
      const h = new StepupHarness();
      const user = h.register();
      h.setStoredSignCount(user, 5);
      runChecks(h.validStepupContext(user, { signCount: 5 }), checks);
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

describe('step-up attacks', () => {
  it('has a scenario for every step-up check', () => {
    expect(scenarios.map((s) => s.check).sort(byId)).toEqual(
      STEPUP_CHECKS.map((c) => c.id).sort(byId),
    );
  });

  it.each([
    ['with userHandle', {}],
    ['without userHandle (allowCredentials set)', { userHandle: null }],
  ])('accepts the session user approving with their own passkey %s', (_, overrides) => {
    const h = new StepupHarness();
    const ctx = h.validStepupContext(h.register(), overrides);
    runChecks(ctx, STEPUP_CHECKS);
    expect(saveStepup(h.deps, ctx).txHash).toBe(transferTxHash(TX));
  });

  describe.each(scenarios)('$check: $attack', (s) => {
    it(`is rejected by ${s.rejectedBy} in the full pipeline`, () => {
      expect(
        rejection(() => {
          s.run(STEPUP_CHECKS);
        }),
      ).toBe(s.rejectedBy);
    });

    const outcome = s.withoutCheckRejectedBy
      ? `is still rejected by ${s.withoutCheckRejectedBy}`
      : 'is accepted';
    it(`${outcome} once ${s.check} is removed`, () => {
      const withoutCheck = STEPUP_CHECKS.filter((c) => c.id !== s.check);
      expect(
        rejection(() => {
          s.run(withoutCheck);
        }),
      ).toBe(s.withoutCheckRejectedBy);
    });
  });

  it("without S1, the attacker's own passkey approves the victim's transfer", () => {
    const h = new StepupHarness();
    const victim = h.register('test-user-1');
    const attacker = h.register('test-user-2');
    const ctx = h.validStepupContext(victim, { userHandle: null }, attacker);
    runChecks(
      ctx,
      STEPUP_CHECKS.filter((c) => c.id !== 'S1'),
    );
    expect(ctx.credential?.userId).toBe(attacker.userId);
    // The approval would be recorded on the victim's session for the victim's transfer.
    expect(saveStepup(h.deps, ctx).txHash).toBe(transferTxHash(TX));
  });

  it('C2 rejects a login challenge answered as a step-up', () => {
    const h = new StepupHarness();
    const user = h.register();
    const begun = h.beginLogin();
    const ctx = h.stepupContext(h.assert(begun, user), user.userId);
    expect(
      rejection(() => {
        runChecks(ctx, STEPUP_CHECKS);
      }),
    ).toBe('C2');
  });

  it('A4 also holds against two concurrent step-ups with the same counter', () => {
    const h = new StepupHarness();
    const user = h.register();
    h.setStoredSignCount(user, 5);
    const first = h.validStepupContext(user, { signCount: 6 });
    const second = h.validStepupContext(user, { signCount: 6 });
    runChecks(first, STEPUP_CHECKS);
    runChecks(second, STEPUP_CHECKS);
    saveStepup(h.deps, first);
    expect(
      rejection(() => {
        saveStepup(h.deps, second);
      }),
    ).toBe('A4');
  });

  it("offers only the session user's credentials", () => {
    const h = new StepupHarness();
    const user = h.register('test-user-1');
    h.register('test-user-2');
    const options = h.beginStepup(user);
    const ids = h.db
      .prepare('SELECT id FROM credentials WHERE user_id = ?')
      .all(user.userId)
      .map((r) => Buffer.from((r as { id: Uint8Array }).id).toString('base64url'));
    expect(options.allowCredentials.map((c) => c.id)).toEqual(ids);
    expect(options.userVerification).toBe('required');
  });
});
