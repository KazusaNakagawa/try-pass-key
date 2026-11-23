import { CheckError, type AuthenticationContext, type Check } from './types.js';

/**
 * A4: signCount increased since the last login, unless both are 0.
 * Synced passkeys always report 0 (they cannot keep one counter across devices).
 * For authenticators that do count, a value that does not increase means two
 * copies of the same key exist: a cloned authenticator.
 */
export const A4: Check<AuthenticationContext> = {
  id: 'A4',
  title: 'signCount increased (or both are 0)',
  run(ctx) {
    if (!ctx.credential) throw new CheckError('A4', 'no stored signCount to compare with');
    const stored = ctx.credential.signCount;
    const received = ctx.authData.signCount;
    if (stored === 0 && received === 0) return;
    if (received <= stored) {
      throw new CheckError('A4', `signCount ${received} is not greater than ${stored}`);
    }
  },
};
