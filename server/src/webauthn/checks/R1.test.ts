import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { SoftAuthenticator } from '../../../test/soft-authenticator.js';
import { R1 } from './R1.js';

describe('R1 algorithm in pubKeyCredParams', () => {
  it.each([-7, -257] as const)('accepts alg %i', (alg) => {
    const ctx = new RegistrationHarness().validContext({}, new SoftAuthenticator({ alg }));
    expect(() => {
      R1.run(ctx);
    }).not.toThrow();
  });

  it('rejects an algorithm the RP did not request (EdDSA)', () => {
    const ctx = new RegistrationHarness().validContext({}, new SoftAuthenticator({ alg: -8 }));
    expectRejectedBy(() => {
      R1.run(ctx);
    }, 'R1');
  });
});
