import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getSessionState,
  hasSession,
  markSignedIn,
  markSignedOut,
  refreshSession,
  resetSession,
  SESSION_EVENT,
  signOut,
} from './session.js';

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function install(fetchMock: ReturnType<typeof vi.fn>, storage?: Storage) {
  const events: Event[] = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', {
    dispatchEvent: (e: Event) => (events.push(e), true),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  vi.stubGlobal('sessionStorage', storage);
  return events;
}

describe('session (cookie model)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetSession();
  });

  it('starts unknown and learns it is signed in from GET /api/auth/me with the cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { user: { id: 'u' } }));
    const events = install(fetchMock);
    expect(getSessionState()).toBe('unknown');
    await refreshSession();
    expect(hasSession()).toBe(true);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/auth/me');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['X-VTT-Client']).toBe('web');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(events.map((e) => e.type)).toEqual([SESSION_EVENT]);
  });

  it('asks once per load however many components ask', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, {}));
    install(fetchMock);
    await Promise.all([refreshSession(), refreshSession()]);
    await refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a 401 means signed out; a network failure leaves it unknown', async () => {
    install(vi.fn().mockResolvedValue(json(401, { error: 'session_invalid' })));
    await refreshSession();
    expect(getSessionState()).toBe('out');

    resetSession();
    install(vi.fn().mockRejectedValue(new TypeError('offline')));
    await refreshSession();
    expect(getSessionState()).toBe('unknown');
  });

  it('announces changes, and only real ones, so a header updates without a reload', () => {
    const events = install(vi.fn());
    markSignedIn();
    markSignedIn();
    markSignedOut();
    expect(events.map((e) => e.type)).toEqual([SESSION_EVENT, SESSION_EVENT]);
    expect(hasSession()).toBe(false);
  });

  it('sign-out posts to the server (which clears the cookie) and flips to signed out at once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    install(fetchMock);
    markSignedIn();
    await signOut();
    expect(getSessionState()).toBe('out');
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/auth/logout');
    expect(init.method).toBe('POST');
  });

  it('never writes to storage, and drops the token an earlier build left in sessionStorage', async () => {
    const removed: string[] = [];
    const storage = {
      setItem: vi.fn(),
      getItem: vi.fn(),
      removeItem: (k: string) => void removed.push(k),
    } as unknown as Storage;
    install(vi.fn().mockResolvedValue(json(200, {})), storage);
    await refreshSession();
    markSignedOut();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(removed).toEqual(['vtt-chat.session']);
  });
});
