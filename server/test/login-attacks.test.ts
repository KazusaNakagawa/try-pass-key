/**
 * Attack reproduction for login (docs/01 §6, K4). For every login check:
 *   1. the full pipeline rejects the attack, and
 *   2. with only that check removed, the attack is accepted
 *      (or, where noted, still rejected by another check: defense in depth).
 * Do not delete or skip these tests.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CheckError,
  type AuthenticationContext,
  type Check,
  type CheckId,
} from '../src/webauthn/checks/types.js';
import { AUTHENTICATION_CHECKS, runChecks } from '../src/webauthn/pipeline.js';
import { LoginHarness } from './login-harness.js';

type Checks = readonly Check<AuthenticationContext>[];

const byId = (a: string, b: string) => a.localeCompare(b);

interface Scenario {
  check: CheckId;
  attack: string;
  rejectedBy: CheckId;
  /** undefined: accepted once the check is removed. Otherwise the check that still rejects it. */
  withoutCheckRejectedBy?: CheckId;
  run(checks: Checks): void;
}

/** One registered user and one login attempt with tampered fields. */
function simple(
  check: CheckId,
  attack: string,
  overrides: Parameters<LoginHarness['validLoginContext']>[1],
): Scenario {
  return {
    check,
    attack,
    rejectedBy: check,
    run: (checks) => {
      const h = new LoginHarness();
      runChecks(h.validLoginContext(h.register(), overrides), checks);
    },
  };
}

const scenarios: Scenario[] = [
  simple('C1', 'a registration (webauthn.create) response is used to log in', {
    type: 'webauthn.create',
  }),
  {
    check: 'C2',
    attack: 'a response to an expired challenge is submitted',
    rejectedBy: 'C2',
    run: (checks) => {
      const h = new LoginHarness();
      const user = h.register();
      const begun = h.beginLogin();
      h.clock = new Date(h.clock.getTime() + 10 * 60 * 1000);
      runChecks(h.loginContext(h.assert(begun, user), begun.ceremonyId), checks);
    },
  },
  simple('C3', 'a response created on a phishing origin is relayed', {
    origin: 'https://evil.example',
  }),
  {
    check: 'C4',
    attack: 'a captured login response is replayed',
    rejectedBy: 'C2',
    run: (checks) => {
      const h = new LoginHarness();
      const user = h.register();
      const begun = h.beginLogin();
      const response = h.assert(begun, user);
      runChecks(h.loginContext(response, begun.ceremonyId), checks);
      runChecks(h.loginContext(response, begun.ceremonyId), checks);
    },
  },
  {
    check: 'C5',
    attack: "a leaked login response is submitted from the attacker's browser",
    rejectedBy: 'C5',
    run: (checks) => {
      const h = new LoginHarness();
      const user = h.register();
      const victim = h.beginLogin();
      const attacker = h.beginLogin();
      runChecks(h.loginContext(h.assert(victim, user), attacker.ceremonyId), checks);
    },
  },
  simple('A1', 'a signature from a credential scoped to another RP ID', { rpId: 'evil.example' }),
  simple('A2', 'the authenticator signs with nobody present (UP=0)', { flags: { up: false } }),
  simple('A3', 'login without biometrics or PIN (UV=0)', { flags: { uv: false } }),
  {
    check: 'L1',
    attack: 'a key that was never registered is used',
    rejectedBy: 'L1',
    // L2 and L3 need the stored credential, so they still reject it.
    withoutCheckRejectedBy: 'L2',
    run: (checks) => {
      const h = new LoginHarness();
      runChecks(h.validLoginContext(h.register(), { credentialId: randomBytes(16) }), checks);
    },
  },
  {
    check: 'L2',
    attack: "the attacker signs with their own key and sends the victim's userHandle",
    rejectedBy: 'L2',
    run: (checks) => {
      const h = new LoginHarness();
      const victim = h.register('test-user-1');
      const attacker = h.register('test-user-2');
      runChecks(h.validLoginContext(attacker, { userHandle: victim.userHandle }), checks);
    },
  },
  {
    check: 'L3',
    attack: 'the signature is forged with a key the attacker controls',
    rejectedBy: 'L3',
    run: (checks) => {
      const h = new LoginHarness();
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      runChecks(h.validLoginContext(h.register(), { signWith: privateKey }), checks);
    },
  },
  {
    check: 'A4',
    attack: 'a cloned authenticator reuses a signCount that was already seen',
    rejectedBy: 'A4',
    run: (checks) => {
      const h = new LoginHarness();
      const user = h.register();
      h.setStoredSignCount(user, 5);
      runChecks(h.validLoginContext(user, { signCount: 5 }), checks);
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

describe('login attacks', () => {
  it('has a scenario for every login check', () => {
    expect(scenarios.map((s) => s.check).sort(byId)).toEqual(
      AUTHENTICATION_CHECKS.map((c) => c.id).sort(byId),
    );
  });

  describe.each(scenarios)('$check: $attack', (s) => {
    it(`is rejected by ${s.rejectedBy} in the full pipeline`, () => {
      expect(
        rejection(() => {
          s.run(AUTHENTICATION_CHECKS);
        }),
      ).toBe(s.rejectedBy);
    });

    const outcome = s.withoutCheckRejectedBy
      ? `is still rejected by ${s.withoutCheckRejectedBy}`
      : 'is accepted';
    it(`${outcome} once ${s.check} is removed`, () => {
      const withoutCheck = AUTHENTICATION_CHECKS.filter((c) => c.id !== s.check);
      expect(
        rejection(() => {
          s.run(withoutCheck);
        }),
      ).toBe(s.withoutCheckRejectedBy);
    });
  });

  it('without L2, the attacker would be logged in as the victim', () => {
    const h = new LoginHarness();
    const victim = h.register('test-user-1');
    const attacker = h.register('test-user-2');
    const ctx = h.validLoginContext(attacker, { userHandle: victim.userHandle });
    runChecks(
      ctx,
      AUTHENTICATION_CHECKS.filter((c) => c.id !== 'L2'),
    );
    // The session is created for the user that userHandle names.
    expect(ctx.userByHandle?.id).toBe(victim.userId);
    expect(ctx.credential?.userId).toBe(attacker.userId);
  });
});
