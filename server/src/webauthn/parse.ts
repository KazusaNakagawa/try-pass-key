import { z } from 'zod';
import { fromBase64Url } from './bytes.js';
import { cborItemLength, decodeCbor } from './cbor.js';
import { ParseError } from './errors.js';

// ---------------------------------------------------------------------------
// clientDataJSON: JSON built by the browser, signed together with authData.
// ---------------------------------------------------------------------------

const ClientDataJson = z.object({
  type: z.string(),
  challenge: z.string(),
  origin: z.string(),
  crossOrigin: z.boolean().optional(),
  topOrigin: z.string().optional(),
});

export interface ClientData {
  /** "webauthn.create" or "webauthn.get" */
  type: string;
  /** Decoded challenge bytes. */
  challenge: Buffer;
  /** Origin the browser saw (scheme://host:port). The browser fills this, not the page. */
  origin: string;
  /** true when called from a cross-origin iframe. */
  crossOrigin: boolean;
  /** The exact bytes, needed for the signature (SHA-256(clientDataJSON)). */
  raw: Buffer;
}

export function parseClientDataJSON(b64url: string): ClientData {
  const raw = fromBase64Url(b64url, 'clientDataJSON');
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ParseError('clientDataJSON is not JSON');
  }
  const parsed = ClientDataJson.safeParse(json);
  if (!parsed.success) throw new ParseError('clientDataJSON is missing required fields');
  return {
    type: parsed.data.type,
    challenge: fromBase64Url(parsed.data.challenge, 'clientDataJSON.challenge'),
    origin: parsed.data.origin,
    crossOrigin: parsed.data.crossOrigin === true,
    raw,
  };
}

// ---------------------------------------------------------------------------
// authenticatorData: binary, produced and signed by the authenticator.
//
//   rpIdHash (32) | flags (1) | signCount (4, big endian)
//   [ attestedCredentialData ]  if AT
//       aaguid (16) | credentialIdLength (2) | credentialId | credentialPublicKey (COSE, CBOR)
//   [ extensions (CBOR) ]       if ED
// ---------------------------------------------------------------------------

export interface AuthenticatorFlags {
  /** User Present: someone touched / interacted. */
  up: boolean;
  /** User Verified: biometrics or PIN succeeded. */
  uv: boolean;
  /** Backup Eligible: the credential can be synced. */
  be: boolean;
  /** Backup State: the credential is currently synced. */
  bs: boolean;
  /** Attested credential data included (registration). */
  at: boolean;
  /** Extension data included. */
  ed: boolean;
}

export interface AttestedCredentialData {
  aaguid: Buffer;
  credentialId: Buffer;
  /** COSE_Key, raw CBOR bytes as stored by the RP. */
  credentialPublicKey: Buffer;
}

export interface AuthenticatorData {
  raw: Buffer;
  rpIdHash: Buffer;
  flags: AuthenticatorFlags;
  signCount: number;
  attestedCredentialData: AttestedCredentialData | undefined;
  extensions: unknown;
}

const FLAG = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 } as const;

export function parseAuthenticatorData(raw: Buffer): AuthenticatorData {
  if (raw.length < 37) throw new ParseError('authenticatorData is shorter than 37 bytes');

  const rpIdHash = raw.subarray(0, 32);
  const flagsByte = raw.readUInt8(32);
  const flags: AuthenticatorFlags = {
    up: (flagsByte & FLAG.UP) !== 0,
    uv: (flagsByte & FLAG.UV) !== 0,
    be: (flagsByte & FLAG.BE) !== 0,
    bs: (flagsByte & FLAG.BS) !== 0,
    at: (flagsByte & FLAG.AT) !== 0,
    ed: (flagsByte & FLAG.ED) !== 0,
  };
  const signCount = raw.readUInt32BE(33);
  let pos = 37;

  let attestedCredentialData: AttestedCredentialData | undefined;
  if (flags.at) {
    if (raw.length < pos + 18) throw new ParseError('attestedCredentialData is truncated');
    const aaguid = raw.subarray(pos, pos + 16);
    const idLength = raw.readUInt16BE(pos + 16);
    pos += 18;
    if (raw.length < pos + idLength) throw new ParseError('credentialId is truncated');
    const credentialId = raw.subarray(pos, pos + idLength);
    pos += idLength;
    const keyLength = cborItemLength(raw, pos);
    const credentialPublicKey = raw.subarray(pos, pos + keyLength);
    pos += keyLength;
    attestedCredentialData = { aaguid, credentialId, credentialPublicKey };
  }

  let extensions: unknown;
  if (flags.ed) {
    const extLength = cborItemLength(raw, pos);
    extensions = decodeCbor(raw.subarray(pos, pos + extLength));
    pos += extLength;
  }

  if (pos !== raw.length) throw new ParseError('authenticatorData has trailing bytes');
  return { raw, rpIdHash, flags, signCount, attestedCredentialData, extensions };
}

// ---------------------------------------------------------------------------
// attestationObject: CBOR map { fmt, attStmt, authData } returned on registration.
// ---------------------------------------------------------------------------

export interface AttestationObject {
  fmt: string;
  attStmt: Map<unknown, unknown>;
  authData: Buffer;
}

export function parseAttestationObject(b64url: string): AttestationObject {
  const decoded = decodeCbor(fromBase64Url(b64url, 'attestationObject'));
  if (!(decoded instanceof Map)) throw new ParseError('attestationObject is not a CBOR map');
  const fmt: unknown = decoded.get('fmt');
  const attStmt: unknown = decoded.get('attStmt');
  const authData: unknown = decoded.get('authData');
  if (typeof fmt !== 'string') throw new ParseError('attestationObject.fmt is missing');
  if (!(attStmt instanceof Map)) throw new ParseError('attestationObject.attStmt is missing');
  if (!(authData instanceof Uint8Array)) {
    throw new ParseError('attestationObject.authData is missing');
  }
  return { fmt, attStmt, authData: Buffer.from(authData) };
}
