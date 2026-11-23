import { CheckError, type CeremonyContext, type Check } from './types.js';

/** C1: clientDataJSON.type matches the ceremony. Stops a registration response being used to log in, or vice versa. */
export const C1: Check<CeremonyContext> = {
  id: 'C1',
  title: 'clientDataJSON.type is webauthn.create / webauthn.get',
  run(ctx) {
    if (ctx.clientData.type !== ctx.expected.type) {
      throw new CheckError('C1', `type is ${ctx.clientData.type}, expected ${ctx.expected.type}`);
    }
  },
};
