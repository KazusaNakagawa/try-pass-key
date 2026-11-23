/**
 * A software authenticator for tests. It builds registration responses the way
 * a real authenticator + browser would, but every field can be tampered with,
 * so tests can produce the malicious inputs that §6 checks must reject.
 */
import { createHash, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import type { RegistrationResponse } from '@app/shared';
import { standardCbor } from './cbor-encoder.js';

const cbor = standardCbor;

export type SoftAlg = -7 | -257 | -8;

export interface Flags {
  up: boolean;
  uv: boolean;
  be: boolean;
  bs: boolean;
}

export interface AttestationOverrides {
  type?: string;
  origin?: string;
  crossOrigin?: boolean;
  /** Challenge to sign (base64url). Defaults to the one from the options. */
  challenge?: string;
  /** RP ID hashed into authenticatorData. */
  rpId?: string;
  flags?: Partial<Flags>;
  /** Credential ID the browser reports (rawId/id), independent of authData. */
  reportedCredentialId?: Buffer;
}

export class SoftAuthenticator {
  readonly credentialId: Buffer = randomBytes(16);
  readonly alg: SoftAlg;
  readonly privateKey: KeyObject;
  private readonly coseKey: Map<number, unknown>;
  private readonly defaultFlags: Flags;

  constructor(opts: { alg?: SoftAlg; flags?: Partial<Flags> } = {}) {
    this.alg = opts.alg ?? -7;
    this.defaultFlags = { up: true, uv: true, be: true, bs: true, ...opts.flags };
    const { privateKey, coseKey } = generateKey(this.alg);
    this.privateKey = privateKey;
    this.coseKey = coseKey;
  }

  /** navigator.credentials.create() + browser serialization (RegistrationResponseJSON). */
  createCredential(
    input: { challenge: string; origin: string; rpId: string },
    o: AttestationOverrides = {},
  ): RegistrationResponse {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: o.type ?? 'webauthn.create',
        challenge: o.challenge ?? input.challenge,
        origin: o.origin ?? input.origin,
        crossOrigin: o.crossOrigin ?? false,
      }),
    );
    const flags = { ...this.defaultFlags, ...o.flags };
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      createHash('sha256')
        .update(o.rpId ?? input.rpId)
        .digest(),
      Buffer.from([flagsByte(flags, { at: true })]),
      Buffer.alloc(4), // signCount 0, like synced passkeys
      Buffer.alloc(16), // AAGUID: zeros (real authenticators may send their own, e.g. 1Password)
      idLength,
      this.credentialId,
      cbor.encode(this.coseKey),
    ]);
    const attestationObject = cbor.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    const reportedId = (o.reportedCredentialId ?? this.credentialId).toString('base64url');
    return {
      id: reportedId,
      rawId: reportedId,
      type: 'public-key',
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        attestationObject: attestationObject.toString('base64url'),
        transports: ['internal', 'hybrid'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}

function flagsByte(f: Flags, extra: { at: boolean }): number {
  return (
    (f.up ? 0x01 : 0) |
    (f.uv ? 0x04 : 0) |
    (f.be ? 0x08 : 0) |
    (f.bs ? 0x10 : 0) |
    (extra.at ? 0x40 : 0)
  );
}

function generateKey(alg: SoftAlg): { privateKey: KeyObject; coseKey: Map<number, unknown> } {
  const b = (s: string | undefined) => Buffer.from(s ?? '', 'base64url');
  if (alg === -7) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    return {
      privateKey,
      coseKey: new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, b(jwk.x)],
        [-3, b(jwk.y)],
      ]),
    };
  }
  if (alg === -257) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    return {
      privateKey,
      coseKey: new Map<number, unknown>([
        [1, 3],
        [3, -257],
        [-1, b(jwk.n)],
        [-2, b(jwk.e)],
      ]),
    };
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    privateKey,
    coseKey: new Map<number, unknown>([
      [1, 1],
      [3, -8],
      [-1, 6],
      [-2, b(jwk.x)],
    ]),
  };
}
