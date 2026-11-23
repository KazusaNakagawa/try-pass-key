import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from '../config.js';
import { readCookie } from '../http/cookies.js';
import { HttpError } from '../http/errors.js';
import {
  createSession,
  destroySession,
  loadSession,
  SESSION_ABSOLUTE_MS,
  type Session,
} from './sessions.js';

export const SESSION_COOKIE = 'session';

function sessionCookieOptions(config: Config): CookieOptions {
  return {
    httpOnly: true,
    // Lax: sent on top-level navigation from other sites, not on cross-site POSTs.
    // State-changing requests are additionally protected by the Origin check.
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_ABSOLUTE_MS,
    secure: config.rpOrigin.startsWith('https:'),
  };
}

export interface SessionDeps {
  db: DatabaseSync;
  config: Config;
  now: () => Date;
}

/**
 * Logs the user in with a brand-new session ID. Any session the browser already
 * had is destroyed first, so an ID planted before login (session fixation) is
 * never upgraded to an authenticated one.
 */
export function startSession(deps: SessionDeps, req: Request, res: Response, userId: string) {
  const previous = readCookie(req, SESSION_COOKIE);
  if (previous) destroySession(deps.db, previous);
  const token = createSession(deps.db, userId, deps.now());
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(deps.config));
  const session = loadSession(deps.db, token, deps.now());
  if (!session) throw new Error('session was not created');
  return session;
}

export function endSession(deps: SessionDeps, req: Request, res: Response): void {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) destroySession(deps.db, token);
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(deps.config), maxAge: undefined });
}

/** Rejects the request with 401 unless it carries a live session. */
export function requireSession(deps: SessionDeps): RequestHandler {
  return (req, res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    const session = token ? loadSession(deps.db, token, deps.now()) : undefined;
    if (!session) {
      next(new HttpError(401, 'unauthenticated', 'login required'));
      return;
    }
    res.locals.session = session;
    next();
  };
}

export function currentSession(res: Response): Session {
  const session = res.locals.session as Session | undefined;
  if (!session) throw new Error('requireSession middleware is missing');
  return session;
}
