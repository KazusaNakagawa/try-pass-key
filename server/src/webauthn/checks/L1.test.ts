import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { LoginHarness } from '../../../test/login-harness.js';
import { L1 } from './L1.js';

describe('L1 credential is registered', () => {
  it('accepts a registered credential', () => {
    const h = new LoginHarness();
    const ctx = h.validLoginContext(h.register());
    expect(() => {
      L1.run(ctx);
    }).not.toThrow();
  });

  it('rejects an unknown credential ID', () => {
    const h = new LoginHarness();
    const ctx = h.validLoginContext(h.register(), { credentialId: randomBytes(16) });
    expectRejectedBy(() => {
      L1.run(ctx);
    }, 'L1');
  });
});
