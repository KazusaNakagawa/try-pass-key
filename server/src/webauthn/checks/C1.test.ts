import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { C1 } from './C1.js';

describe('C1 clientDataJSON.type', () => {
  it('accepts webauthn.create for registration', () => {
    const ctx = new RegistrationHarness().validContext();
    expect(() => {
      C1.run(ctx);
    }).not.toThrow();
  });

  it('rejects a webauthn.get response sent to registration', () => {
    const ctx = new RegistrationHarness().validContext({ type: 'webauthn.get' });
    expectRejectedBy(() => {
      C1.run(ctx);
    }, 'C1');
  });
});
