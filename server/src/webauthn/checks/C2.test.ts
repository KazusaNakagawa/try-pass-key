import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { C2 } from './C2.js';

describe('C2 challenge issued, right purpose, unexpired', () => {
  it('accepts the challenge from the options', () => {
    const ctx = new RegistrationHarness().validContext();
    expect(() => {
      C2.run(ctx);
    }).not.toThrow();
  });

  it('rejects a challenge the server never issued', () => {
    const ctx = new RegistrationHarness().validContext({
      challenge: randomBytes(32).toString('base64url'),
    });
    expectRejectedBy(() => {
      C2.run(ctx);
    }, 'C2');
  });

  it('rejects an expired challenge', () => {
    const h = new RegistrationHarness();
    const begun = h.begin();
    h.clock = new Date(h.clock.getTime() + 5 * 60 * 1000);
    const ctx = h.context(h.respond(begun), begun.ceremonyId);
    expectRejectedBy(() => {
      C2.run(ctx);
    }, 'C2');
  });

  it('rejects a challenge issued for another purpose', () => {
    const ctx = new RegistrationHarness().validContext();
    const row = ctx.challengeRow;
    expect(row).toBeDefined();
    if (!row) return;
    expectRejectedBy(() => {
      C2.run({ ...ctx, challengeRow: { ...row, purpose: 'login' } });
    }, 'C2');
  });
});
