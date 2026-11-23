import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { A1 } from './A1.js';

describe('A1 rpIdHash', () => {
  it('accepts SHA-256 of the RP ID', () => {
    const ctx = new RegistrationHarness().validContext();
    expect(() => {
      A1.run(ctx);
    }).not.toThrow();
  });

  it('rejects a credential scoped to another RP ID', () => {
    const ctx = new RegistrationHarness().validContext({ rpId: 'evil.example' });
    expectRejectedBy(() => {
      A1.run(ctx);
    }, 'A1');
  });
});
