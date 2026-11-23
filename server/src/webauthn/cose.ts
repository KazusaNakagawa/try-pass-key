import { createPublicKey, type KeyObject, type webcrypto } from 'node:crypto';
import { toBase64Url } from './bytes.js';
import { decodeCbor } from './cbor.js';
import { ParseError } from './errors.js';

/** COSE algorithm identifiers used in this PoC. */
export const COSE_ALG = { ES256: -7, EdDSA: -8, RS256: -257 } as const;

// COSE_Key labels (RFC 9052 / 9053)
const KTY = 1;
const ALG = 3;
const CRV = -1; // EC2 / OKP
const X = -2; // EC2 / OKP
const Y = -3; // EC2
const N = -1; // RSA
const E = -2; // RSA

const KTY_OKP = 1;
const KTY_EC2 = 2;
const KTY_RSA = 3;
const CRV_P256 = 1;
const CRV_ED25519 = 6;

export interface CosePublicKey {
  /** COSE algorithm identifier, checked against pubKeyCredParams (R1). */
  alg: number;
  keyObject: KeyObject;
}

/**
 * Converts a COSE_Key into a node:crypto public key via JWK.
 * Only (key type, algorithm) pairs that make sense together are accepted; whether
 * the algorithm is one the RP asked for is R1's job, not the parser's.
 */
export function parseCosePublicKey(raw: Uint8Array): CosePublicKey {
  const key = decodeCbor(raw);
  if (!(key instanceof Map)) throw new ParseError('credentialPublicKey is not a COSE map');
  const kty: unknown = key.get(KTY);
  const alg: unknown = key.get(ALG);
  if (typeof alg !== 'number') throw new ParseError('COSE key has no alg');

  let jwk: webcrypto.JsonWebKey;
  if (kty === KTY_EC2 && alg === COSE_ALG.ES256) {
    if (key.get(CRV) !== CRV_P256) throw new ParseError('ES256 key is not on P-256');
    jwk = { kty: 'EC', crv: 'P-256', x: bytesParam(key, X, 32), y: bytesParam(key, Y, 32) };
  } else if (kty === KTY_RSA && alg === COSE_ALG.RS256) {
    jwk = { kty: 'RSA', n: bytesParam(key, N), e: bytesParam(key, E) };
  } else if (kty === KTY_OKP && alg === COSE_ALG.EdDSA) {
    if (key.get(CRV) !== CRV_ED25519) throw new ParseError('EdDSA key is not Ed25519');
    jwk = { kty: 'OKP', crv: 'Ed25519', x: bytesParam(key, X, 32) };
  } else {
    throw new ParseError(`unsupported COSE key (kty=${String(kty)}, alg=${String(alg)})`);
  }

  try {
    return { alg, keyObject: createPublicKey({ key: jwk, format: 'jwk' }) };
  } catch (err) {
    throw new ParseError(`invalid public key: ${String(err)}`);
  }
}

function bytesParam(key: Map<unknown, unknown>, label: number, length?: number): string {
  const value: unknown = key.get(label);
  if (!(value instanceof Uint8Array) || (length !== undefined && value.length !== length)) {
    throw new ParseError(`COSE key parameter ${label} is invalid`);
  }
  return toBase64Url(value);
}
