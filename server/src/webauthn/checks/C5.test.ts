import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
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
