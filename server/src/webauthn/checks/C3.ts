import { CheckError, type CeremonyContext, type Check } from './types.js';

/**
 * C3: clientDataJSON.origin is exactly the RP origin, and the call did not come
 * from a cross-origin iframe. The browser writes the origin itself, so a phishing
 * site cannot fake it.
 */
export const C3: Check<CeremonyContext> = {
  id: 'C3',
  title: 'origin equals the RP origin and crossOrigin is not true',
  run(ctx) {
    if (ctx.clientData.origin !== ctx.expected.origin) {
      throw new CheckError('C3', `origin ${ctx.clientData.origin} is not allowed`);
    }
    if (ctx.clientData.crossOrigin) {
      throw new CheckError('C3', 'called from a cross-origin iframe');
    }
  },
};
