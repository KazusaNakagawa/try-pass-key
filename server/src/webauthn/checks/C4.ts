import { CheckError, type CeremonyContext, type Check } from './types.js';

/**
 * C4: the challenge is consumed (deleted) as soon as it is looked up, whether the
 * rest of verification passes or not. Stops the same challenge being used twice.
 */
export const C4: Check<CeremonyContext> = {
  id: 'C4',
  title: 'challenge is consumed on first use',
  run(ctx) {
    if (!ctx.consumeChallenge()) {
      throw new CheckError('C4', 'challenge was already consumed');
    }
  },
};
