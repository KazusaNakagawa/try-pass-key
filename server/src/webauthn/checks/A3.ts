import { CheckError, type CeremonyContext, type Check } from './types.js';

/** A3: the UV flag is set. Rejects use without biometrics or PIN (e.g. a found device). */
export const A3: Check<CeremonyContext> = {
  id: 'A3',
  title: 'User Verified (UV) flag is set',
  run(ctx) {
    if (!ctx.authData.flags.uv) throw new CheckError('A3', 'user was not verified');
  },
};
