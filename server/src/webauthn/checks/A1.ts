import { bytesEqual } from '../bytes.js';
import { CheckError, type CeremonyContext, type Check } from './types.js';

/** A1: authenticatorData.rpIdHash is SHA-256(RP ID). Rejects a credential scoped to another domain. */
export const A1: Check<CeremonyContext> = {
  id: 'A1',
  title: 'rpIdHash equals SHA-256(RP ID)',
  run(ctx) {
    if (!bytesEqual(ctx.authData.rpIdHash, ctx.expected.rpIdHash)) {
      throw new CheckError('A1', 'rpIdHash does not match the RP ID');
    }
  },
};
