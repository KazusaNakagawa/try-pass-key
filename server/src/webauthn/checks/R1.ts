import { CheckError, type Check, type RegistrationContext } from './types.js';

/** R1: the public key's algorithm is one the RP listed in pubKeyCredParams. */
export const R1: Check<RegistrationContext> = {
  id: 'R1',
  title: 'public key algorithm is in pubKeyCredParams',
  run(ctx) {
    if (!ctx.expected.algorithms.includes(ctx.publicKey.alg)) {
      throw new CheckError('R1', `algorithm ${ctx.publicKey.alg} was not requested`);
    }
  },
};
