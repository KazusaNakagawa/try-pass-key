import { CheckError, type AuthenticationContext, type Check } from './types.js';

/** L1: the credential ID is registered. Unknown keys are rejected. */
export const L1: Check<AuthenticationContext> = {
  id: 'L1',
  title: 'credential ID is registered',
  run(ctx) {
    if (!ctx.credential) throw new CheckError('L1', 'unknown credential');
  },
};
