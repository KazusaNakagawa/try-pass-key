import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { LoginHarness } from '../../../test/login-harness.js';
import { L2 } from './L2.js';

describe('L2 credential belongs to the user named by userHandle', () => {
  it('accepts the owner', () => {
    const h = new LoginHarness();
    const ctx = h.validLoginContext(h.register());
    expect(() => {
      L2.run(ctx);
    }).not.toThrow();
  });

  it("rejects the attacker's credential sent with the victim's userHandle", () => {
    const h = new LoginHarness();
    const victim = h.register('test-user-1');
    const attacker = h.register('test-user-2');
    const ctx = h.validLoginContext(attacker, { userHandle: victim.userHandle });
    expectRejectedBy(() => {
      L2.run(ctx);
    }, 'L2');
  });

  it('rejects a response without userHandle', () => {
    const h = new LoginHarness();
    const ctx = h.validLoginContext(h.register(), { userHandle: null });
    expectRejectedBy(() => {
      L2.run(ctx);
    }, 'L2');
  });

  it('rejects a userHandle that names no user', () => {
    const h = new LoginHarness();
    const ctx = h.validLoginContext(h.register(), { userHandle: Buffer.alloc(32, 7) });
    expectRejectedBy(() => {
      L2.run(ctx);
    }, 'L2');
  });
});
