import { CheckError, type Check, type RegistrationContext } from './types.js';

/**
 * R3: the BE / BS flags are consistent so they can be stored and trusted later
 * (synced or device-bound). A credential that cannot be backed up cannot be
 * backed up right now: BE=0 with BS=1 is invalid.
 */
export const R3: Check<RegistrationContext> = {
  id: 'R3',
  title: 'backup flags are consistent (BS=1 requires BE=1)',
  run(ctx) {
    const { be, bs } = ctx.authData.flags;
    if (!be && bs) throw new CheckError('R3', 'BS is set but BE is not');
  },
};
