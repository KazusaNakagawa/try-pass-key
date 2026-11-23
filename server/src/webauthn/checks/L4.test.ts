import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { LoginHarness } from '../../../test/login-harness.js';
import { SoftAuthenticator } from '../../../test/soft-authenticator.js';
import { L4 } from './L4.js';

describe('L4 backup flags agree with the stored credential', () => {
  it('accepts a synced passkey (BE=1) that stays BE=1', () => {
    const h = new LoginHarness();
    const ctx = h.validLoginContext(h.register());
    expect(() => {
      L4.run(ctx);
    }).not.toThrow();
  });

  it('accepts BS changing while BE stays the same', () => {
    const h = new LoginHarness();
    const ctx = h.validLoginContext(h.register(), { flags: { bs: false } });
    expect(() => {
      L4.run(ctx);
    }).not.toThrow();
  });

  it('rejects a device-bound credential (BE=0) that now claims BE=1', () => {
    const h = new LoginHarness();
    const deviceBound = new SoftAuthenticator({ flags: { be: false, bs: false } });
    const user = h.register('test-user-1', deviceBound);
    expectRejectedBy(() => {
      L4.run(h.validLoginContext(user, { flags: { be: true, bs: true } }));
    }, 'L4');
  });

  it('rejects a synced credential (BE=1) that now claims BE=0', () => {
    const h = new LoginHarness();
    const ctx = h.validLoginContext(h.register(), { flags: { be: false, bs: false } });
    expectRejectedBy(() => {
      L4.run(ctx);
    }, 'L4');
  });

  it('rejects BS=1 with BE=0', () => {
    const h = new LoginHarness();
    const deviceBound = new SoftAuthenticator({ flags: { be: false, bs: false } });
    const user = h.register('test-user-1', deviceBound);
    expectRejectedBy(() => {
      L4.run(h.validLoginContext(user, { flags: { be: false, bs: true } }));
    }, 'L4');
  });
});
