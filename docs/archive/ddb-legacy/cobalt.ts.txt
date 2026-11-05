import { decodeJwt } from 'jose';

import {
  DDB_COBALT_COOKIE_NAME,
  DDB_COBALT_TOKEN_REFRESH_MARGIN_MS,
  DDB_COBALT_TOKEN_URL,
} from '../consts/index.js';
import type { CobaltTokenResponse } from '../types/index.js';

export class CobaltExchangeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'CobaltExchangeError';
  }
}

export interface CobaltToken {
  jwt: string;
  /** DDB user id, read from the JWT's `sub` claim. Verify live — see docs/architecture/DDB-AUTH.md. */
  ddbUserId: string;
  expiresAtMs: number;
}

/**
 * Exchanges the `CobaltSession` cookie value for a short-lived DDB JWT.
 * Per DDB-AUTH.md, this token is ~5min-lived — callers should re-exchange before each
 * Character Service call rather than cache long-term; see {@link isCobaltTokenFresh}.
 */
export async function exchangeCobaltToken(cookieValue: string): Promise<CobaltToken> {
  const response = await fetch(DDB_COBALT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Cookie: `${DDB_COBALT_COOKIE_NAME}=${cookieValue}`,
    },
  });

  if (!response.ok) {
    throw new CobaltExchangeError(
      `cobalt-token exchange failed with status ${response.status}`,
      response.status,
    );
  }

  const body = (await response.json()) as CobaltTokenResponse;
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new CobaltExchangeError('cobalt-token response did not contain a token');
  }

  const claims = decodeJwt(body.token);
  const ddbUserId = claims.sub;
  if (typeof ddbUserId !== 'string' || ddbUserId.length === 0) {
    throw new CobaltExchangeError(
      'cobalt JWT did not contain a usable "sub" claim for the DDB user id',
    );
  }

  const expiresAtMs = typeof claims.exp === 'number' ? claims.exp * 1000 : Date.now();

  return { jwt: body.token, ddbUserId, expiresAtMs };
}

export function isCobaltTokenFresh(token: CobaltToken, nowMs: number = Date.now()): boolean {
  return nowMs < token.expiresAtMs - DDB_COBALT_TOKEN_REFRESH_MARGIN_MS;
}
