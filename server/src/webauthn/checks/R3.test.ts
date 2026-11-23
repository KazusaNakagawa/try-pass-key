import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { R3 } from './R3.js';

describe('R3 backup flags consistent', () => {
  it.each([
    { be: true, bs: true },
    { be: true, bs: false },
    { be: false, bs: false },
  ])('accepts BE=$be BS=$bs', (flags) => {
    const ctx = new RegistrationHarness().validContext({ flags });
    expect(() => {
      R3.run(ctx);
    }).not.toThrow();
  });

  it('rejects BS=1 with BE=0', () => {
    const ctx = new RegistrationHarness().validContext({ flags: { be: false, bs: true } });
    expectRejectedBy(() => {
      R3.run(ctx);
    }, 'R3');
  });
});
