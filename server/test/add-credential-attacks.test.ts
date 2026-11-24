/**
 * Attack reproduction for adding a passkey to an existing account (docs/01 §5.4,
 * §6). The ceremony runs REGISTRATION_CHECKS with purpose add_credential. For
 * each scenario, the full pipeline rejects the attack and, with only that check
 * removed, the attack is accepted (or, where noted, still rejected by another
 * check). The operation gate in front of saving is covered by
 * operation-gate-attacks.test.ts. Do not delete or skip these tests.
 */
import { describe, expect, it } from 'vitest';
import {
  CheckError,
  type Check,
  type CheckId,
  type RegistrationContext,
} from '../src/webauthn/checks/types.js';
import { saveAddedCredential } from '../src/webauthn/add-credential.js';
import { REGISTRATION_CHECKS, runChecks } from '../src/webauthn/pipeline.js';
import { AddCredentialHarness } from './add-credential-harness.js';
import { SoftAuthenticator } from './soft-authenticator.js';

type Checks = readonly Check<RegistrationContext>[];

interface Scenario {
  check: CheckId;
  attack: string;
  rejectedBy: CheckId;
  withoutCheckRejectedBy?: CheckId;
  run(checks: Checks): void;
}

const scenarios: Scenario[] = [
  {
    check: 'C5',
    attack:
      "the attacker answers the victim's leaked add challenge with their own key, from their own session",
    rejectedBy: 'C5',
    run: (checks) => {
      const h = new AddCredentialHarness();
      const leaked = h.beginAdd(h.victim);
      const ctx = h.addContext(h.respondAdd(leaked), h.sessionFor(h.attacker));
      runChecks(ctx, checks);
    },
  },
  {
    check: 'C2',
    attack: 'a response to a new-account registration challenge is submitted as adding a passkey',
    rejectedBy: 'C2',
    // The register row has no session, so C5 cannot match it to the submitting session.
    withoutCheckRejectedBy: 'C5',
    run: (checks) => {
      const h = new AddCredentialHarness();
      const begun = h.begin('test-user-3');
      const ctx = h.addContext(h.respond(begun), h.sessionFor(h.victim));
      runChecks(ctx, checks);
    },
  },
  {
    check: 'C2',
    attack: 'a response to an add challenge is submitted as a new-account registration',
    rejectedBy: 'C2',
    run: (checks) => {
      const h = new AddCredentialHarness();
      const options = h.beginAdd(h.victim);
      const response = h.respondAdd(options);
      // Even with the cookie naming that very row.
      const rowId = rowIdOf(h, options.challenge);
      runChecks(h.context(response, rowId), checks);
    },
  },
  {
    check: 'R2',
    attack: "the attacker's existing credential ID is added again to the victim's account",
    rejectedBy: 'R2',
    run: (checks) => {
      const h = new AddCredentialHarness();
      const ctx = h.addContext(
        h.respondAdd(h.beginAdd(h.victim), h.attacker.authenticator),
        h.sessionFor(h.victim),
      );
      runChecks(ctx, checks);
    },
  },
];

function rowIdOf(h: AddCredentialHarness, challenge: string): string {
  const row = h.db
    .prepare('SELECT id FROM challenges WHERE challenge = ?')
    .get(Buffer.from(challenge, 'base64url')) as { id: string } | undefined;
  if (!row) throw new Error('no challenge row');
  return row.id;
}

function rejection(run: () => void): CheckId | undefined {
  try {
    run();
    return undefined;
  } catch (err) {
    if (err instanceof CheckError) return err.check;
    throw err;
  }
}

describe('add-credential attacks', () => {
  it('lets the user add a second passkey from their own session', () => {
    const h = new AddCredentialHarness();
    const ctx = h.addContext(h.respondAdd(h.beginAdd(h.victim)), h.sessionFor(h.victim));
    expect(
      rejection(() => {
        runChecks(ctx, REGISTRATION_CHECKS);
      }),
    ).toBeUndefined();
  });

  describe.each(scenarios)('$check: $attack', (s) => {
    it(`is rejected by ${s.rejectedBy} in the full pipeline`, () => {
      expect(
        rejection(() => {
          s.run(REGISTRATION_CHECKS);
        }),
      ).toBe(s.rejectedBy);
    });

    const outcome = s.withoutCheckRejectedBy
      ? `is still rejected by ${s.withoutCheckRejectedBy}`
      : 'is accepted';
    it(`${outcome} once ${s.check} is removed`, () => {
      const withoutCheck = REGISTRATION_CHECKS.filter((c) => c.id !== s.check);
      expect(
        rejection(() => {
          s.run(withoutCheck);
        }),
      ).toBe(s.withoutCheckRejectedBy);
    });
  });

  it("without C5, the attacker's key is saved on the victim's account", () => {
    const h = new AddCredentialHarness();
    const attackerKey = new SoftAuthenticator();
    const leaked = h.beginAdd(h.victim);
    const ctx = h.addContext(h.respondAdd(leaked, attackerKey), h.sessionFor(h.attacker));
    runChecks(
      ctx,
      REGISTRATION_CHECKS.filter((c) => c.id !== 'C5'),
    );
    const saved = saveAddedCredential(h.deps, ctx, []);
    expect(saved.userId).toBe(h.victim.userId);
    expect(h.credentialCount(h.victim.userId)).toBe(2);
    expect(h.credentialCount(h.attacker.userId)).toBe(1);
  });
});
