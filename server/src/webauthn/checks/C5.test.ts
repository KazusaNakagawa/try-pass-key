import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { LoginHarness } from '../../../test/login-harness.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { C5 } from './C5.js';

describe('C5 challenge bound to the requesting browser', () => {
  it('accepts when the ceremony cookie names the challenge row', () => {
    const ctx = new RegistrationHarness().validContext();
    expect(() => {
      C5.run(ctx);
    }).not.toThrow();
  });

  it('rejects when there is no ceremony cookie', () => {
    const h = new RegistrationHarness();
    const begun = h.begin();
    const ctx = h.context(h.respond(begun), undefined);
    expectRejectedBy(() => {
      C5.run(ctx);
    }, 'C5');
  });

  it("rejects when the cookie names another browser's ceremony", () => {
    const h = new RegistrationHarness();
    const victim = h.begin();
    const attacker = h.begin();
    const ctx = h.context(h.respond(victim), attacker.ceremonyId);
    expectRejectedBy(() => {
      C5.run(ctx);
    }, 'C5');
  });
});

describe('C5 for step-up: challenge bound to the session user', () => {
  /** A step-up context: the row was issued for `rowUserId`, the request comes from `sessionUserId`. */
  function stepupContext(rowUserId: string | null, sessionUserId: string | undefined) {
    const h = new LoginHarness();
    const ctx = h.validLoginContext(h.register());
    if (!ctx.challengeRow) throw new Error('harness issued no challenge');
    return {
      ...ctx,
      expected: { ...ctx.expected, purpose: 'stepup' as const },
      challengeRow: { ...ctx.challengeRow, purpose: 'stepup' as const, userId: rowUserId },
      ceremonyId: undefined,
      sessionUserId,
    };
  }

  it('accepts without a ceremony cookie when the row was issued to the session user', () => {
    expect(() => {
      C5.run(stepupContext('u1', 'u1'));
    }).not.toThrow();
  });

  it("rejects a challenge issued to another user's session", () => {
    expectRejectedBy(() => {
      C5.run(stepupContext('victim', 'attacker'));
    }, 'C5');
  });

  it('rejects when there is no session user', () => {
    expectRejectedBy(() => {
      C5.run(stepupContext('u1', undefined));
    }, 'C5');
  });

  it('rejects a row without a user', () => {
    expectRejectedBy(() => {
      C5.run(stepupContext(null, 'u1'));
    }, 'C5');
  });
});
