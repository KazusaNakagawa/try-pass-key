import { describe, expect, it } from 'vitest';
import { ParseError } from './errors.js';
import { parseAuthenticatorData, parseClientDataJSON } from './parse.js';

describe('parseAuthenticatorData', () => {
  const header = (flags: number, signCount = 7) => {
    const b = Buffer.alloc(37);
    b.fill(0xab, 0, 32);
    b.writeUInt8(flags, 32);
    b.writeUInt32BE(signCount, 33);
    return b;
  };

  it('reads rpIdHash, flags and signCount', () => {
    const d = parseAuthenticatorData(header(0x01 | 0x04 | 0x08));
    expect(d.rpIdHash).toEqual(Buffer.alloc(32, 0xab));
    expect(d.flags).toEqual({ up: true, uv: true, be: true, bs: false, at: false, ed: false });
    expect(d.signCount).toBe(7);
    expect(d.attestedCredentialData).toBeUndefined();
  });

  it('rejects data shorter than 37 bytes', () => {
    expect(() => parseAuthenticatorData(Buffer.alloc(36))).toThrow(ParseError);
  });

  it('rejects trailing bytes', () => {
    expect(() => parseAuthenticatorData(Buffer.concat([header(0x01), Buffer.from([0])]))).toThrow(
      /trailing/,
    );
  });

  it('rejects AT without attested credential data', () => {
    expect(() => parseAuthenticatorData(header(0x41))).toThrow(ParseError);
  });
});

describe('parseClientDataJSON', () => {
  const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

  it('decodes the challenge and keeps the raw bytes', () => {
    const b64 = encode({
      type: 'webauthn.create',
      challenge: 'AQID',
      origin: 'http://localhost:5173',
    });
    const cd = parseClientDataJSON(b64);
    expect(cd.challenge).toEqual(Buffer.from([1, 2, 3]));
    expect(cd.crossOrigin).toBe(false);
    expect(cd.raw.toString('base64url')).toBe(b64);
  });

  it('rejects non-base64url input', () => {
    expect(() => parseClientDataJSON('not base64!')).toThrow(ParseError);
  });

  it('rejects JSON without required fields', () => {
    expect(() => parseClientDataJSON(encode({ type: 'webauthn.create' }))).toThrow(ParseError);
  });
});
