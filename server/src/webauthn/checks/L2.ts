import { CheckError, type AuthenticationContext, type Check } from './types.js';

/**
 * L2: the credential belongs to the user that userHandle names.
 *
 * In a username-less login the server learns who is logging in only from
 * userHandle, and the session is created for that user. Without this check an
 * attacker signs with their own (valid) credential, sends the victim's
 * userHandle, and is logged in as the victim.
 */
export const L2: Check<AuthenticationContext> = {
  id: 'L2',
  title: 'credential belongs to the user named by userHandle',
  run(ctx) {
    if (!ctx.userHandle) {
      throw new CheckError('L2', 'no userHandle (required for a discoverable credential)');
    }
    if (!ctx.userByHandle) throw new CheckError('L2', 'userHandle names no user');
    if (ctx.credential?.userId !== ctx.userByHandle.id) {
      throw new CheckError('L2', 'credential does not belong to the user named by userHandle');
    }
  },
};
