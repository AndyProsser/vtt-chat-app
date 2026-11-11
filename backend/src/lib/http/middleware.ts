import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import type { Session, User } from '../../types/index.js';
import type { AccountService } from '../auth/accountService.js';
import { DomainError, type ErrorCode } from '../errors.js';
import {
  clearSessionCookie,
  expectedOrigin,
  COOKIE_REFRESH_AFTER_MS,
  sameOrigin,
  sessionTokenFromCookie,
  setSessionCookie,
} from './sessionCookie.js';

const STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  email_taken: 409,
  consent_required: 403,
  invalid_credentials: 401,
  invalid_token: 400,
  session_invalid: 401,
  forbidden: 403,
  not_found: 404,
  invite_invalid: 400,
  conflict: 409,
  too_large: 413,
  unsupported_media: 415,
  dm_must_transfer: 409,
};

export interface AuthContext {
  user: User;
  session: Session;
}

/**
 * Authenticates a request and records a ping (keeping the device signed in). The credential is
 * `Authorization: Bearer <token>` (desktop app, CLI) or, when there is no such header, the browser session
 * cookie. Bearer wins when both are present. A cookie is sent by the browser on its own, so a cookie-
 * authenticated request that is not a safe method must also come from this server's own origin (CSRF);
 * a Bearer token is never sent ambiently and needs no such check.
 */
export function requireAuth(accounts: AccountService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const match = /^Bearer (.+)$/.exec(req.header('authorization') ?? '');
    if (match?.[1]) {
      res.locals.auth = await accounts.authenticate(match[1], { ping: true });
      return next();
    }
    const cookie = sessionTokenFromCookie(req);
    if (!cookie) throw new DomainError('session_invalid');
    if (!sameOrigin(req.method, req.header('origin'), req.header('referer'), expectedOrigin(req))) {
      res.status(403).json({ error: 'csrf', message: 'cross-origin request refused' });
      return;
    }
    try {
      const result = await accounts.authenticate(cookie, { ping: true });
      res.locals.auth = result;
      res.locals.viaCookie = cookie;
      // Slide the cookie's expiry, but not on every request: once the session was last seen long enough ago.
      if (Date.now() - result.previousSeenAt > COOKIE_REFRESH_AFTER_MS) {
        await refreshSessionCookie(accounts, req, res);
      }
    } catch (error) {
      // A dead session: stop the browser sending it.
      if (error instanceof DomainError && error.code === 'session_invalid') {
        clearSessionCookie(req, res);
      }
      throw error;
    }
    next();
  };
}

/**
 * Re-issues the session cookie with a fresh lifetime, if this request was cookie-authenticated (a Bearer
 * client has no cookie to slide) and it has not already been done for this response.
 */
export async function refreshSessionCookie(
  accounts: AccountService,
  req: Request,
  res: Response,
): Promise<void> {
  const token = res.locals.viaCookie as string | undefined;
  if (!token || res.locals.cookieRefreshed) return;
  res.locals.cookieRefreshed = true;
  setSessionCookie(req, res, token, await accounts.cookieMaxAgeSeconds());
}

export const authOf = (res: Response): AuthContext => res.locals.auth as AuthContext;

/** Never send the password hash (or anything else internal) to a client. */
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    isAdmin: user.isAdmin,
    consentVersion: user.consentVersion,
  };
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof DomainError) {
    // Credential failures get one generic message so the response can't distinguish "no such
    // account" from "wrong password".
    res.status(STATUS[error.code]).json({ error: error.code, message: error.message });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'invalid_input',
      message: 'the request body is not valid',
      issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    return;
  }
  // Client errors raised by Express/body-parser itself (413 payload too large, 415, …) carry their
  // own 4xx status; passing them through keeps a bad request from looking like a server bug.
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res
      .status(status)
      .json({ error: 'invalid_request', message: 'the request could not be accepted' });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'invalid_input', message: 'the request body is not valid JSON' });
    return;
  }
  console.error('[backend] unhandled error', error);
  res.status(500).json({ error: 'internal', message: 'something went wrong' });
}
