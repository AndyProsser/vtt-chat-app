import { afterEach, describe, expect, it, vi } from 'vitest';

import { request } from './api.js';

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
