import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { R2 } from './R2.js';

describe('R2 credential ID not registered yet', () => {
  it('accepts a new credential ID', () => {
    const ctx = new RegistrationHarness().validContext();
    expect(() => {
      R2.run(ctx);
    }).not.toThrow();
  });

  it('rejects a credential ID that is already registered', () => {
    const ctx = new RegistrationHarness().validContext();
    expectRejectedBy(() => {
      R2.run({ ...ctx, isCredentialRegistered: () => true });
    }, 'R2');
  });
});
