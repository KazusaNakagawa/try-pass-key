import { CheckError, type Check, type RegistrationContext } from './types.js';

const MIN_RSA_MODULUS_BITS = 2048;
const RSA_EXPONENT = 65537n;

/**
 * R5: the public key is strong enough to rely on. ES256 (P-256) and Ed25519 have
 * a fixed size; RSA is chosen by the authenticator, so a 512-bit or small-exponent
 * key (factorable, i.e. forgeable signatures) would otherwise be accepted.
 */
export const R5: Check<RegistrationContext> = {
  id: 'R5',
  title: 'RSA keys are at least 2048 bits with e = 65537',
  run(ctx) {
    const key = ctx.publicKey.keyObject;
    if (key.asymmetricKeyType !== 'rsa') return;
    const { modulusLength, publicExponent } = key.asymmetricKeyDetails ?? {};
    if (modulusLength === undefined || modulusLength < MIN_RSA_MODULUS_BITS) {
      throw new CheckError('R5', `RSA modulus is ${String(modulusLength)} bits`);
    }
    if (publicExponent !== RSA_EXPONENT) {
      throw new CheckError('R5', `RSA public exponent is ${String(publicExponent)}`);
    }
  },
};
