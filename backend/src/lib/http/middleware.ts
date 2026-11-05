import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import type { Session, User } from '../../types/index.js';
import type { AccountService } from '../auth/accountService.js';
import { DomainError, type ErrorCode } from '../errors.js';

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
  dm_must_transfer: 409,
};

export interface AuthContext {
  user: User;
  session: Session;
}

/** Reads `Authorization: Bearer <token>`, checks it, and records a ping (keeping the device signed in). */
export function requireAuth(accounts: AccountService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer (.+)$/.exec(header);
    if (!match?.[1]) throw new DomainError('session_invalid');
    res.locals.auth = await accounts.authenticate(match[1], { ping: true });
    next();
  };
}

export const authOf = (res: Response): AuthContext => res.locals.auth as AuthContext;

/** Never send the password hash (or anything else internal) to a client. */
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
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
