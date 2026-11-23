import { CheckError, type AuthenticationContext, type Check } from './types.js';

/**
 * L4: the backup flags agree with the stored credential (WebAuthn L3 §7.2).
 * Backup Eligible is fixed when the credential is created, so BE must equal the
 * value stored at registration; and BS=1 requires BE=1 (same rule as R3).
 * A mismatch means the response did not come from the authenticator that
 * registered the credential, and storing it would make the BE/BS record that
 * risk decisions rely on (docs/02 §2) contradict itself.
 */
export const L4: Check<AuthenticationContext> = {
  id: 'L4',
  title: 'BE equals the stored value and BS=1 requires BE=1',
  run(ctx) {
    if (!ctx.credential) throw new CheckError('L4', 'no stored backup flags to compare with');
    const { be, bs } = ctx.authData.flags;
    if (be !== ctx.credential.backupEligible) {
      throw new CheckError(
        'L4',
        `BE is ${be ? 1 : 0} but was ${ctx.credential.backupEligible ? 1 : 0} at registration`,
      );
    }
    if (!be && bs) throw new CheckError('L4', 'BS is set but BE is not');
  },
};
