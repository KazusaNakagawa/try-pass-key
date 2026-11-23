import type { CookieOptions, Request } from 'express';
import type { Config } from '../config.js';
import { CHALLENGE_TTL_MS } from '../webauthn/constants.js';

/** Names the challenge row issued to this browser (docs/01 §8, check C5). */
export const CEREMONY_COOKIE = 'ceremony';

export function ceremonyCookieOptions(config: Config): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: '/api',
    maxAge: CHALLENGE_TTL_MS,
    secure: config.rpOrigin.startsWith('https:'),
  };
}

/** Reads one cookie from the Cookie header (no cookie-parser dependency). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}
