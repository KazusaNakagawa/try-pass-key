import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { LoginHarness, type RegisteredUser } from '../../../test/login-harness.js';
import type { AssertionOverrides } from '../../../test/soft-authenticator.js';
import { S1 } from './S1.js';
import type { StepupContext } from './types.js';

/** `signer` answers a step-up started by `sessionUser`. */
function stepupContext(
  h: LoginHarness,
  sessionUser: RegisteredUser,
  signer: RegisteredUser,
  overrides: AssertionOverrides = {},
): StepupContext {
  return {
    ...h.validLoginContext(signer, overrides),
    sessionUserId: sessionUser.userId,
    sessionId: 'session-a',
  };
}

describe('S1 credential belongs to the session user', () => {
  it('accepts the session user without userHandle', () => {
    const h = new LoginHarness();
    const user = h.register();
    expect(() => {
      S1.run(stepupContext(h, user, user, { userHandle: null }));
    }).not.toThrow();
  });

  it('accepts the session user with their own userHandle', () => {
    const h = new LoginHarness();
    const user = h.register();
    expect(() => {
      S1.run(stepupContext(h, user, user));
    }).not.toThrow();
  });

  it("rejects the attacker's own credential used in the victim's session", () => {
    const h = new LoginHarness();
    const victim = h.register('test-user-1');
    const attacker = h.register('test-user-2');
    expectRejectedBy(() => {
      S1.run(stepupContext(h, victim, attacker, { userHandle: null }));
    }, 'S1');
  });

  it('rejects a userHandle that names another user', () => {
    const h = new LoginHarness();
    const user = h.register('test-user-1');
    const other = h.register('test-user-2');
    expectRejectedBy(() => {
      S1.run(stepupContext(h, user, user, { userHandle: other.userHandle }));
    }, 'S1');
  });

  it('rejects a userHandle that names no user', () => {
    const h = new LoginHarness();
    const user = h.register();
    expectRejectedBy(() => {
      S1.run(stepupContext(h, user, user, { userHandle: Buffer.alloc(32, 7) }));
    }, 'S1');
  });

  it('rejects an unknown credential', () => {
    const h = new LoginHarness();
    const user = h.register();
    expectRejectedBy(() => {
      S1.run(stepupContext(h, user, user, { credentialId: Buffer.alloc(16, 9) }));
    }, 'S1');
  });
});
