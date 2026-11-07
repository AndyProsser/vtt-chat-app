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

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
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

/** The browser session was only for joining; the app signs in for itself. */
export const signOut = (token: string) =>
  request('POST', '/api/auth/logout', { token }).catch(() => undefined);
