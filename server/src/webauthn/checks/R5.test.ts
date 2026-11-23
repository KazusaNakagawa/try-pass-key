import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { SoftAuthenticator } from '../../../test/soft-authenticator.js';
import { R5 } from './R5.js';

describe('R5 public key strength', () => {
  it.each([-7, -257] as const)('accepts a standard alg %i key', (alg) => {
    const ctx = new RegistrationHarness().validContext({}, new SoftAuthenticator({ alg }));
    expect(() => {
      R5.run(ctx);
    }).not.toThrow();
  });

  it('rejects a 1024-bit RSA key', () => {
    const weak = new SoftAuthenticator({
      alg: -257,
      rsa: { modulusLength: 1024, publicExponent: 65537 },
    });
    expectRejectedBy(() => {
      R5.run(new RegistrationHarness().validContext({}, weak));
    }, 'R5');
  });

  it('rejects an RSA key with e = 3', () => {
    const weak = new SoftAuthenticator({
      alg: -257,
      rsa: { modulusLength: 2048, publicExponent: 3 },
    });
    expectRejectedBy(() => {
      R5.run(new RegistrationHarness().validContext({}, weak));
    }, 'R5');
  });
});
