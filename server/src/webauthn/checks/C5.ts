import { CheckError, type CeremonyContext, type Check } from './types.js';

/**
 * C5: the challenge was issued to the browser that is submitting the response
 * (the "ceremony" cookie names the same row). A leaked signed response cannot be
 * submitted from another browser.
 *
 * A step-up happens inside a logged-in session, so it is bound to the session's
 * user instead of a cookie: the row must have been issued to that user (D14).
 */
export const C5: Check<CeremonyContext> = {
  id: 'C5',
  title: 'challenge was issued to the requesting browser (ceremony cookie)',
  run(ctx) {
    if (ctx.expected.purpose === 'stepup') {
      if (ctx.sessionUserId === undefined) throw new CheckError('C5', 'no session user');
      if (ctx.challengeRow?.userId !== ctx.sessionUserId) {
        throw new CheckError('C5', "challenge was issued to another user's session");
      }
      return;
    }
    if (ctx.ceremonyId === undefined) {
      throw new CheckError('C5', 'no ceremony cookie');
    }
    if (ctx.challengeRow?.id !== ctx.ceremonyId) {
      throw new CheckError('C5', 'challenge was issued to a different browser');
    }
  },
};
