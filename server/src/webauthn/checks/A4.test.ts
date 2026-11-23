import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { LoginHarness } from '../../../test/login-harness.js';
import { A4 } from './A4.js';

describe('A4 signCount', () => {
  it('accepts 0 after 0 (synced passkey)', () => {
    const h = new LoginHarness();
    const ctx = h.validLoginContext(h.register(), { signCount: 0 });
    expect(() => {
      A4.run(ctx);
    }).not.toThrow();
  });

  it('accepts an increasing counter', () => {
    const h = new LoginHarness();
    const user = h.register();
    h.setStoredSignCount(user, 5);
    expect(() => {
      A4.run(h.validLoginContext(user, { signCount: 6 }));
    }).not.toThrow();
  });

  it.each([5, 4, 0])('rejects %i after 5 (cloned authenticator)', (received) => {
    const h = new LoginHarness();
    const user = h.register();
    h.setStoredSignCount(user, 5);
    expectRejectedBy(() => {
      A4.run(h.validLoginContext(user, { signCount: received }));
    }, 'A4');
  });
});
