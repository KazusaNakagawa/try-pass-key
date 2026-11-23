import { bytesEqual } from '../bytes.js';
import { CheckError, type CeremonyContext, type Check } from './types.js';

/** C2: the challenge was issued by this server, for this purpose, and has not expired. Stops replay of old responses. */
export const C2: Check<CeremonyContext> = {
  id: 'C2',
  title: 'challenge was issued by the server, for this purpose, and is unexpired',
  run(ctx) {
    const row = ctx.challengeRow;
    if (!row) throw new CheckError('C2', 'challenge was not issued or was already used');
    if (!bytesEqual(row.challenge, ctx.clientData.challenge)) {
      throw new CheckError('C2', 'challenge does not match');
    }
    if (row.purpose !== ctx.expected.purpose) {
      throw new CheckError('C2', `challenge was issued for ${row.purpose}`);
    }
    if (new Date(row.expiresAt) <= ctx.expected.now) {
      throw new CheckError('C2', 'challenge has expired');
    }
  },
};
