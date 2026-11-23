import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { SoftAuthenticator } from '../../../test/soft-authenticator.js';
import { R4 } from './R4.js';

describe('R4 credential ID length', () => {
  it('accepts 1023 bytes', () => {
    const ctx = new RegistrationHarness().validContext(
      {},
      new SoftAuthenticator({ credentialIdLength: 1023 }),
    );
    expect(() => {
      R4.run(ctx);
    }).not.toThrow();
  });

  it('rejects 1024 bytes', () => {
    const ctx = new RegistrationHarness().validContext(
      {},
      new SoftAuthenticator({ credentialIdLength: 1024 }),
    );
    expectRejectedBy(() => {
      R4.run(ctx);
    }, 'R4');
  });
});
