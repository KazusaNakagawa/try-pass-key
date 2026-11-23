import { createHash, verify, type KeyObject } from 'node:crypto';
import { COSE_ALG, parseCosePublicKey } from '../cose.js';
import { CheckError, type AuthenticationContext, type Check } from './types.js';

/**
 * L3: the signature over authenticatorData ‖ SHA-256(clientDataJSON) verifies
 * with the stored public key. This is authentication itself: only the holder of
 * the private key can produce it, and it covers the challenge, origin, rpIdHash
 * and flags checked above.
 */
export const L3: Check<AuthenticationContext> = {
  id: 'L3',
  title: 'signature verifies with the stored public key',
  run(ctx) {
    if (!ctx.credential) throw new CheckError('L3', 'no stored public key to verify against');
    const signed = Buffer.concat([
      ctx.authData.raw,
      createHash('sha256').update(ctx.clientData.raw).digest(),
    ]);
    const { alg, keyObject } = parseCosePublicKey(ctx.credential.publicKey);
    if (!verifySignature(alg, keyObject, signed, ctx.signature)) {
      throw new CheckError('L3', 'signature is invalid');
    }
  },
};

function verifySignature(alg: number, key: KeyObject, data: Buffer, signature: Buffer): boolean {
  try {
    switch (alg) {
      case COSE_ALG.ES256:
        // WebAuthn ES256 signatures are ASN.1 DER, which is node:crypto's default for ECDSA.
        return verify('sha256', data, { key, dsaEncoding: 'der' }, signature);
      case COSE_ALG.RS256:
        return verify('sha256', data, key, signature);
      case COSE_ALG.EdDSA:
        return verify(null, data, key, signature);
      default:
        return false;
    }
  } catch {
    // A malformed signature (e.g. invalid DER) is just an invalid signature.
    return false;
  }
}
