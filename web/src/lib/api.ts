import type { InvitePreview, SignUpInput } from '../types/index.js';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string; keepalive?: boolean } = {},
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.keepalive ? { keepalive: true } : {}),
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new ApiError(
      String(data.error ?? 'error'),
      String(data.message ?? `request failed (${response.status})`),
      response.status,
    );
  }
  return data as T;
}

export const previewInvite = (code: string) =>
  request<InvitePreview>('GET', `/api/invites/${encodeURIComponent(code)}`);

interface Session {
  sessionToken: string | null;
  needsConsent?: boolean;
}

export async function signUp(input: SignUpInput): Promise<string> {
  const res = await request<Session>('POST', '/api/auth/register', {
    body: {
      email: input.email,
      displayName: input.displayName,
      password: input.password,
      acceptedConsentVersion: input.consentVersion,
    },
  });
  if (!res.sessionToken) throw new ApiError('no_session', 'account created but not signed in', 500);
  return res.sessionToken;
}

export async function signIn(
  email: string,
  password: string,
  consentVersion: string,
): Promise<string> {
  const res = await request<Session>('POST', '/api/auth/login', {
    body: { email, password, deviceLabel: 'Browser (join page)' },
  });
  if (!res.sessionToken) throw new ApiError('no_session', 'sign-in failed', 401);
  if (res.needsConsent) {
    await request('POST', '/api/auth/consent', {
      token: res.sessionToken,
      body: { version: consentVersion },
    });
  }
  return res.sessionToken;
}

export const joinCampaign = (token: string, code: string) =>
  request('POST', '/api/campaigns/join', { token, body: { code } });

/** Ends the browser session (the join page signs out when it closes or after a while). */
export const signOut = (token: string) =>
  request('POST', '/api/auth/logout', { token, keepalive: true }).catch(() => undefined);

export interface LinkCode {
  /** The short typed fallback, `ABCD-2345`. */
  code: string;
  /** Long single-use token for the deep link; absent only from a server older than 0.4. */
  linkToken?: string;
  expiresAt: number;
}

/** Single-use, 5-minute credentials (a deep-link token and a typed code) that sign the app in as this session's account. */
export const createLinkCode = (token: string) =>
  request<LinkCode>('POST', '/api/auth/link-codes', { token });

/** A /connect sign-in: the session, and whether the recording notice must be accepted first. */
export interface ConnectSignIn {
  token: string;
  needsConsent: boolean;
}

function connectSignIn(res: Session): ConnectSignIn {
  if (!res.sessionToken) throw new ApiError('no_session', 'sign-in failed', 401);
  return { token: res.sessionToken, needsConsent: res.needsConsent === true };
}

/** Password sign-in for the /connect page: no campaign. A changed notice is accepted before approving. */
export async function signInPlain(email: string, password: string): Promise<ConnectSignIn> {
  return connectSignIn(
    await request<Session>('POST', '/api/auth/login', {
      body: { email, password, deviceLabel: 'Browser (connect page)' },
    }),
  );
}

/**
 * Accepts the recording notice the server currently shows. The version comes from
 * `/api/auth/providers`, the same source the phone sign-in uses; the server refuses a stale one.
 */
export async function acceptCurrentConsent(token: string): Promise<void> {
  const { consentVersion } = await request<{ consentVersion: string }>(
    'GET',
    '/api/auth/providers',
  );
  await request('POST', '/api/auth/consent', { token, body: { version: consentVersion } });
}

/** Whether this server can email codes (SMTP configured). */
export const mailAvailable = () =>
  request<{ mail?: boolean }>('GET', '/api/auth/providers').then(
    (p) => p.mail === true,
    () => false,
  );

export const emailSignInCode = (email: string) =>
  request('POST', '/api/auth/magic-link', { body: { email, purpose: 'signin' } });

export async function redeemEmailCode(token: string): Promise<ConnectSignIn> {
  return connectSignIn(
    await request<Session>('POST', '/api/auth/magic-link/redeem', { body: { token } }),
  );
}

/** Whether the operator lets visitors request an account (`signup.requests` is on). */
export const signupRequestsAvailable = () =>
  request<{ signupRequests?: boolean }>('GET', '/api/auth/providers').then(
    (p) => p.signupRequests === true,
    () => false,
  );

/** Asks the operator for an account. The answer is the same whether or not the address is known. */
export const requestAccount = (input: { email: string; displayName: string; message?: string }) =>
  request<{ ok: true }>('POST', '/api/signup-requests', { body: input });
