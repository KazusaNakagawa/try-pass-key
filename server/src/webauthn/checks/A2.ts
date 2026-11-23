import { CheckError, type CeremonyContext, type Check } from './types.js';

/** A2: the UP flag is set. Rejects signatures made without anyone present. */
export const A2: Check<CeremonyContext> = {
  id: 'A2',
  title: 'User Present (UP) flag is set',
  run(ctx) {
    if (!ctx.authData.flags.up) throw new CheckError('A2', 'user was not present');
  },
};
