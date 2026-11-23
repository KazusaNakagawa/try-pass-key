import { CheckError, type Check, type RegistrationContext } from './types.js';

/** R2: the credential ID is not registered yet. Stops re-registering someone else's credential ID under a new account. */
export const R2: Check<RegistrationContext> = {
  id: 'R2',
  title: 'credential ID is not registered yet',
  run(ctx) {
    if (ctx.isCredentialRegistered(ctx.attestedCredentialData.credentialId)) {
      throw new CheckError('R2', 'credential is already registered');
    }
  },
};
