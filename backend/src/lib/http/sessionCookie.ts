import type { Request, Response } from 'express';

/**
 * The browser session cookie. A browser that sends `X-VTT-Client: web` on a sign-in gets the session as an
 * HttpOnly cookie and never sees the token; every other client (the desktop app, the CLI, tests) keeps the
 * `Authorization: Bearer` token it always had. Both are the same opaque, hashed, revocable server session.
 *
 * `__Host-` (HTTPS only) makes the browser refuse a cookie that has a Domain, is not Secure, or is not
 * Path=/, so a sibling subdomain cannot plant or shadow it. Plain HTTP (localhost dev) cannot be Secure, so
 * it gets the unprefixed name.
 */
export const SECURE_COOKIE = '__Host-vtt_session';
export const PLAIN_COOKIE = 'vtt_session';
export const WEB_CLIENT_HEADER = 'x-vtt-client';

/** A live cookie is re-issued (slid) at most this often per session, apart from `/api/auth/me`. */
export const COOKIE_REFRESH_AFTER_MS = 60 * 60_000;

/** Methods that cannot change anything; everything else needs a CSRF check when a cookie is the credential. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const isWebClient = (req: Request): boolean =>
  req.header(WEB_CLIENT_HEADER)?.toLowerCase() === 'web';

export const cookieName = (secure: boolean): string => (secure ? SECURE_COOKIE : PLAIN_COOKIE);

/** The value of one cookie from a `Cookie` header, or undefined. Values here are opaque URL-safe tokens. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value === '' ? undefined : value;
  }
  return undefined;
}

function serialise(name: string, value: string, secure: boolean, maxAgeSeconds: number): string {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
    `Max-Age=${maxAgeSeconds}`,
    ...(maxAgeSeconds === 0 ? ['Expires=Thu, 01 Jan 1970 00:00:00 GMT'] : []),
  ].join('; ');
}

/**
 * Sets (or re-sets, which slides the expiry) the session cookie. It is persistent: `maxAgeSeconds` is the
 * operator's offline limit, the same idle window the server enforces on the session itself. The server's
 * check stays the source of truth; the cookie merely should not vanish before the session does.
 */
export function setSessionCookie(
  req: Request,
  res: Response,
  token: string,
  maxAgeSeconds: number,
): void {
  res.append(
    'Set-Cookie',
    serialise(cookieName(req.secure), encodeURIComponent(token), req.secure, maxAgeSeconds),
  );
}

/** Clears the session cookie for this request's scheme. */
export function clearSessionCookie(req: Request, res: Response): void {
  res.append('Set-Cookie', serialise(cookieName(req.secure), '', req.secure, 0));
}

export function sessionTokenFromCookie(req: Request): string | undefined {
  const raw = readCookie(req.header('cookie'), cookieName(req.secure));
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/** `origin` header text (or a Referer URL) reduced to scheme+host, or undefined if it is not a URL. */
function originOf(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'null:' || !url.host ? undefined : url.origin;
  } catch {
    return undefined;
  }
}

/**
 * Whether a cookie-authenticated request came from this server's own pages: its `Origin` (or, when the
 * browser sent none, `Referer`) must be this request's own scheme+host. A safe method needs no check.
 * `expected` is the server's own origin as the browser saw it (trust-proxy aware for Express).
 */
export function sameOrigin(
  method: string,
  origin: string | undefined,
  referer: string | undefined,
  expected: string,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  const claimed = origin !== undefined ? originOf(origin) : referer ? originOf(referer) : undefined;
  return claimed !== undefined && claimed === expected;
}

export const expectedOrigin = (req: Request): string => `${req.protocol}://${req.host}`;

/**
 * Sends a sign-in result. For a web client: sets the (persistent) cookie and withholds `sessionToken` (adding
 * `signedIn: true`); for anyone else: the body is unchanged.
 */
export function sendSession(
  req: Request,
  res: Response,
  body: Record<string, unknown> & { sessionToken?: string | null },
  maxAgeSeconds: number,
  status = 200,
): void {
  const { sessionToken, ...rest } = body;
  if (isWebClient(req) && sessionToken) {
    setSessionCookie(req, res, sessionToken, maxAgeSeconds);
    res.status(status).json({ ...rest, signedIn: true });
    return;
  }
  res.status(status).json(body);
}
