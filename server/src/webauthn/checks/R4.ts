import { CheckError, type Check, type RegistrationContext } from './types.js';

/** Upper bound from WebAuthn Level 3 §7.1 (registration, step "credentialId length"). */
export const MAX_CREDENTIAL_ID_BYTES = 1023;

/**
 * R4: the credential ID is at most 1023 bytes. It becomes a primary key and is
 * sent back in allowCredentials / excludeCredentials, so an oversized ID would be
 * stored and echoed indefinitely.
 */
export const R4: Check<RegistrationContext> = {
  id: 'R4',
  title: 'credential ID is at most 1023 bytes',
  run(ctx) {
    const length = ctx.attestedCredentialData.credentialId.length;
    if (length > MAX_CREDENTIAL_ID_BYTES) {
      throw new CheckError('R4', `credential ID is ${length} bytes`);
    }
  },
};
