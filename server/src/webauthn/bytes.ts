import { timingSafeEqual } from 'node:crypto';
import { ParseError } from './errors.js';

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Decodes base64url strictly. Buffer.from() silently skips invalid characters. */
export function fromBase64Url(value: string, field: string): Buffer {
  if (!BASE64URL.test(value)) {
    throw new ParseError(`${field} is not base64url`);
  }
  return Buffer.from(value, 'base64url');
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** Constant-time comparison that also accepts different lengths (returns false). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
