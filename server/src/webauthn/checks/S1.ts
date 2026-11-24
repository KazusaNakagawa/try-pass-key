import { bytesEqual } from '../bytes.js';
import { CheckError, type Check, type StepupContext } from './types.js';

/**
 * S1: the credential belongs to the user logged in to the session, and a returned
 * userHandle names that user too (WebAuthn L3 §7.2 step 6, when the user was
 * identified before the ceremony).
 *
 * allowCredentials only asks the browser to offer the user's own passkeys; the
 * server must still check. Without this, an attacker holding a stolen session
 * approves the transfer with their own passkey, registered to their own account.
 * L2 is not used here: with allowCredentials set, userHandle may be absent.
 */
export const S1: Check<StepupContext> = {
  id: 'S1',
  title: 'credential belongs to the session user',
  run(ctx) {
    if (ctx.credential?.userId !== ctx.sessionUserId) {
      throw new CheckError('S1', 'credential does not belong to the session user');
    }
    if (ctx.userHandle === undefined) return;
    const owner = ctx.userByHandle;
    if (!owner || owner.id !== ctx.sessionUserId || !bytesEqual(owner.userHandle, ctx.userHandle)) {
      throw new CheckError('S1', 'userHandle does not name the session user');
    }
  },
};
