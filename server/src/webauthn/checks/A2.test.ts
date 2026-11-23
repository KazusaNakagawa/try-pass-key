import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { A2 } from './A2.js';

describe('A2 User Present', () => {
  it('accepts UP=1', () => {
    const ctx = new RegistrationHarness().validContext();
    expect(() => {
      A2.run(ctx);
    }).not.toThrow();
  });

  it('rejects UP=0', () => {
    const ctx = new RegistrationHarness().validContext({ flags: { up: false } });
    expectRejectedBy(() => {
      A2.run(ctx);
    }, 'A2');
  });
});
