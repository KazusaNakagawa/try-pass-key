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

describe('C5 for step-up: challenge bound to the session that asked for it', () => {
  /** The row was issued to session `rowSessionId`; the response arrives with `sessionId`. */
  function stepupContext(rowSessionId: string | null, sessionId: string | undefined) {
    const h = new LoginHarness();
    const ctx = h.validLoginContext(h.register());
    if (!ctx.challengeRow) throw new Error('harness issued no challenge');
    return {
      ...ctx,
      expected: { ...ctx.expected, purpose: 'stepup' as const },
      challengeRow: { ...ctx.challengeRow, purpose: 'stepup' as const, sessionId: rowSessionId },
      ceremonyId: undefined,
      sessionId,
    };
  }

  it('accepts without a ceremony cookie when the row was issued to this session', () => {
    expect(() => {
      C5.run(stepupContext('session-a', 'session-a'));
    }).not.toThrow();
  });

  it("rejects a challenge issued to another session, even the same user's", () => {
    expectRejectedBy(() => {
      C5.run(stepupContext('session-a', 'session-b'));
    }, 'C5');
  });

  it('rejects when there is no session', () => {
    expectRejectedBy(() => {
      C5.run(stepupContext('session-a', undefined));
    }, 'C5');
  });

  it('rejects a row without a session', () => {
    expectRejectedBy(() => {
      C5.run(stepupContext(null, 'session-a'));
    }, 'C5');
  });
});
