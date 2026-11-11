import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acceptCurrentConsent,
  redeemEmailCode,
  request,
  requestAccount,
  signInPlain,
  signupRequestsAvailable,
} from './api.js';

afterEach(() => vi.unstubAllGlobals());

describe('request keepalive', () => {
  it('passes keepalive through and keeps the Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await request('POST', '/api/auth/logout', { token: 't0k', keepalive: true });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t0k');
  });

  it('does not set keepalive by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await request('GET', '/x');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).keepalive).toBeUndefined();
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('connect-page sign-in and the recording notice', () => {
  it('reports when the account has not accepted the current notice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({ user: {}, sessionToken: 'S', needsConsent: true }))),
    );
    expect(await signInPlain('a@b.co', 'pw')).toEqual({ token: 'S', needsConsent: true });
    expect(await redeemEmailCode('code')).toEqual({ token: 'S', needsConsent: true });
  });

  it('reports no consent step when the notice is current', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ user: {}, sessionToken: 'S', needsConsent: false })),
    );
    expect(await signInPlain('a@b.co', 'pw')).toEqual({ token: 'S', needsConsent: false });
  });

  it('accepts the version the server currently shows, with the session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ consentVersion: '7', mail: false, oidc: false }))
      .mockResolvedValueOnce(json({ user: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await acceptCurrentConsent('S');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/providers');
    const [path, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(path).toBe('/api/auth/consent');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ version: '7' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer S');
  });
});

describe('sign-up requests', () => {
  it('reads the providers flag and treats a failure as off', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ signupRequests: true })));
    expect(await signupRequestsAvailable()).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ mail: false })));
    expect(await signupRequestsAvailable()).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await signupRequestsAvailable()).toBe(false);
  });

  it('posts the request and surfaces a rate limit as an ApiError', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ ok: true }, 202));
    vi.stubGlobal('fetch', fetchMock);
    await requestAccount({ email: 'a@b.co', displayName: 'A' });
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/signup-requests');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.co', displayName: 'A' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'rate_limited' }, 429)));
    await expect(requestAccount({ email: 'a@b.co', displayName: 'A' })).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });
});
