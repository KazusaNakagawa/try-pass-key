import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { C3 } from './C3.js';

describe('C3 origin', () => {
  it('accepts the RP origin', () => {
    const ctx = new RegistrationHarness().validContext();
    expect(() => {
      C3.run(ctx);
    }).not.toThrow();
  });

  it('rejects a response produced on another origin (phishing site)', () => {
    const ctx = new RegistrationHarness().validContext({ origin: 'https://evil.example' });
    expectRejectedBy(() => {
      C3.run(ctx);
    }, 'C3');
  });

  it('rejects a call from a cross-origin iframe', () => {
    const ctx = new RegistrationHarness().validContext({ crossOrigin: true });
    expectRejectedBy(() => {
      C3.run(ctx);
    }, 'C3');
  });
});
