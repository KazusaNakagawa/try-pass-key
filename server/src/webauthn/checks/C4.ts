import { CheckError, type CeremonyContext, type Check } from './types.js';

/**
 * C4: the challenge is consumed (deleted) before anything else is checked or
 * decoded, so it is single-use whether verification passes or fails. Stops the
 * same challenge being used twice, including by two concurrent requests.
 */
export const C4: Check<CeremonyContext> = {
  id: 'C4',
  title: 'challenge is consumed on first use, before any other check',
  run(ctx) {
    // Never issued (or already deleted before this request looked it up):
    // nothing to consume. C2 rejects it.
    if (!ctx.challengeRow) return;
    // Two requests can both find the row; only the one whose DELETE removes it may continue.
    if (!ctx.consumeChallenge()) {
      throw new CheckError('C4', 'challenge was consumed by another request');
    }
  },
};
