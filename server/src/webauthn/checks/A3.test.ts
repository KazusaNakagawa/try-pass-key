import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { A3 } from './A3.js';

describe('A3 User Verified', () => {
  it('accepts UV=1', () => {
    const ctx = new RegistrationHarness().validContext();
    expect(() => {
      A3.run(ctx);
    }).not.toThrow();
  });

  it('rejects UV=0 (no biometrics or PIN)', () => {
    const ctx = new RegistrationHarness().validContext({ flags: { uv: false } });
    expectRejectedBy(() => {
      A3.run(ctx);
    }, 'A3');
  });
});
