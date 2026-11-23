/**
 * Attack reproduction (docs/01 §6, K4). For every registration check:
 *   1. the full pipeline rejects the attack, and
 *   2. the same pipeline with only that check removed accepts it.
 * (2) is what shows why the check exists. Do not delete or skip these tests.
 */
import { describe, expect, it } from 'vitest';
import type { Check, CheckId, RegistrationContext } from '../src/webauthn/checks/types.js';
import { CheckError } from '../src/webauthn/checks/types.js';
import { REGISTRATION_CHECKS, runChecks } from '../src/webauthn/pipeline.js';
import { saveRegistration } from '../src/webauthn/registration.js';
import { RegistrationHarness } from './registration-harness.js';
import { SoftAuthenticator } from './soft-authenticator.js';

type Checks = readonly Check<RegistrationContext>[];

const byId = (a: string, b: string) => a.localeCompare(b);

interface Scenario {
  check: CheckId;
  attack: string;
  /** Which check rejects it in the full pipeline (usually the same one). */
  rejectedBy: CheckId;
  /** Runs the attack; throws CheckError if the final step is rejected. */
  run(checks: Checks): void;
}

const scenarios: Scenario[] = [
  {
    check: 'C1',
    attack: 'a login (webauthn.get) response is submitted as a registration',
    rejectedBy: 'C1',
    run: (checks) => {
      runChecks(new RegistrationHarness().validContext({ type: 'webauthn.get' }), checks);
    },
  },
  {
    check: 'C2',
    attack: 'a response to an expired challenge is submitted',
    rejectedBy: 'C2',
    run: (checks) => {
      const h = new RegistrationHarness();
      const begun = h.begin();
      h.clock = new Date(h.clock.getTime() + 10 * 60 * 1000);
      runChecks(h.context(h.respond(begun), begun.ceremonyId), checks);
    },
  },
  {
    check: 'C3',
    attack: 'a response created on a phishing origin is relayed',
    rejectedBy: 'C3',
    run: (checks) => {
      runChecks(new RegistrationHarness().validContext({ origin: 'https://evil.example' }), checks);
    },
  },
  {
    check: 'C4',
    attack: 'one challenge is used twice to register two credentials',
    rejectedBy: 'C2',
    run: (checks) => {
      const h = new RegistrationHarness();
      const begun = h.begin();
      runChecks(h.context(h.respond(begun), begun.ceremonyId), checks);
      // Second response to the same challenge, from a different authenticator.
      runChecks(h.context(h.respond(begun, {}, new SoftAuthenticator()), begun.ceremonyId), checks);
    },
  },
  {
    check: 'C5',
    attack: "a leaked response is submitted from the attacker's browser",
    rejectedBy: 'C5',
    run: (checks) => {
      const h = new RegistrationHarness();
      const victim = h.begin();
      const attacker = h.begin();
      runChecks(h.context(h.respond(victim), attacker.ceremonyId), checks);
    },
  },
  {
    check: 'A1',
    attack: 'a credential scoped to another RP ID is registered',
    rejectedBy: 'A1',
    run: (checks) => {
      runChecks(new RegistrationHarness().validContext({ rpId: 'evil.example' }), checks);
    },
  },
  {
    check: 'A2',
    attack: 'the authenticator signs with nobody present (UP=0)',
    rejectedBy: 'A2',
    run: (checks) => {
      runChecks(new RegistrationHarness().validContext({ flags: { up: false } }), checks);
    },
  },
  {
    check: 'A3',
    attack: 'the credential is created without biometrics or PIN (UV=0)',
    rejectedBy: 'A3',
    run: (checks) => {
      runChecks(new RegistrationHarness().validContext({ flags: { uv: false } }), checks);
    },
  },
  {
    check: 'R1',
    attack: 'a key with an algorithm the RP did not offer is registered',
    rejectedBy: 'R1',
    run: (checks) => {
      runChecks(
        new RegistrationHarness().validContext({}, new SoftAuthenticator({ alg: -8 })),
        checks,
      );
    },
  },
  {
    check: 'R2',
    attack: "someone else's credential ID is registered again under a new account",
    rejectedBy: 'R2',
    run: (checks) => {
      const h = new RegistrationHarness();
      const victimAuthenticator = new SoftAuthenticator();
      const first = h.validContext({}, victimAuthenticator);
      runChecks(first, checks);
      saveRegistration(h.deps, first, []);
      // Without R2 the pipeline accepts; the credentials PRIMARY KEY is the last line of defense.
      runChecks(h.validContext({}, victimAuthenticator), checks);
    },
  },
  {
    check: 'R3',
    attack: 'inconsistent backup flags (BE=0, BS=1) are stored',
    rejectedBy: 'R3',
    run: (checks) => {
      runChecks(new RegistrationHarness().validContext({ flags: { be: false, bs: true } }), checks);
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

describe('registration attacks', () => {
  it('has a scenario for every registration check', () => {
    expect(scenarios.map((s) => s.check).sort(byId)).toEqual(
      REGISTRATION_CHECKS.map((c) => c.id).sort(byId),
    );
  });

  describe.each(scenarios)('$check: $attack', (s) => {
    it(`is rejected by ${s.rejectedBy} in the full pipeline`, () => {
      expect(
        rejection(() => {
          s.run(REGISTRATION_CHECKS);
        }),
      ).toBe(s.rejectedBy);
    });

    it(`is accepted once ${s.check} is removed`, () => {
      const withoutCheck = REGISTRATION_CHECKS.filter((c) => c.id !== s.check);
      expect(
        rejection(() => {
          s.run(withoutCheck);
        }),
      ).toBeUndefined();
    });
  });
});
