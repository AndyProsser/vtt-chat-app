import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { MemoryStore } from '../store/memoryStore.js';
import { readCookie, sameOrigin } from './sessionCookie.js';

const CONFIG = {
  port: 0,
  liveKitUrl: 'ws://livekit.test',
  liveKitApiKey: 'k',
  liveKitApiSecret: 'testsecret-testsecret-testsecret-1234',
};
const PASSWORD = 'correct horse battery';

let server: Server;
let base: string;
let store: MemoryStore;

beforeEach(async () => {
  store = new MemoryStore();
  server = createApp({ config: CONFIG, store }).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

const WEB = { 'X-VTT-Client': 'web' };
const HTTPS = { 'X-Forwarded-Proto': 'https' };

async function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in tests
    body: (text ? JSON.parse(text) : undefined) as any,
    setCookie: res.headers.getSetCookie(),
  };
}

async function register(name = 'ann') {
  await call(
    'POST',
    '/api/auth/register',
    {},
    {
      email: `${name}@example.com`,
      displayName: name,
      password: PASSWORD,
      acceptedConsentVersion: '1',
    },
  );
}

const login = (headers: Record<string, string>, name = 'ann') =>
  call('POST', '/api/auth/login', headers, { email: `${name}@example.com`, password: PASSWORD });

/** `name=value` of the first Set-Cookie, ready to send back. */
const pair = (setCookie: string[]) => setCookie[0]!.split(';')[0]!;

describe('browser session cookie', () => {
  beforeEach(() => register());

  it('sets an HttpOnly Lax cookie and withholds the token for a web client over http', async () => {
    const res = await login(WEB);
    expect(res.status).toBe(200);
    expect(res.body.sessionToken).toBeUndefined();
    expect(res.body.signedIn).toBe(true);
    expect(res.body.user.email).toBe('ann@example.com');
    const [cookie] = res.setCookie;
    expect(cookie).toMatch(
      /^vtt_session=[\w.%-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/,
    );
    expect(cookie).not.toMatch(/Secure|Domain|Expires/);
  });

  it('is Secure with the __Host- prefix when the request is https (behind the proxy)', async () => {
    const res = await login({ ...WEB, ...HTTPS });
    const [cookie] = res.setCookie;
    expect(cookie).toMatch(
      /^__Host-vtt_session=[\w.%-]+; Path=\/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000$/,
    );
    expect(cookie).not.toMatch(/Domain/);
  });

  it('still returns the token, and no cookie, to a client that did not opt in', async () => {
    const res = await login({});
    expect(res.body.sessionToken).toMatch(/\./);
    expect(res.setCookie).toEqual([]);
  });

  it('applies to magic-link redemption and registration as well', async () => {
    const reg = await call('POST', '/api/auth/register', WEB, {
      email: 'bo@example.com',
      displayName: 'bo',
      password: PASSWORD,
      acceptedConsentVersion: '1',
    });
    expect(reg.status).toBe(201);
    expect(reg.body.sessionToken).toBeUndefined();
    expect(reg.setCookie).toHaveLength(1);
    const bad = await call('POST', '/api/auth/magic-link/redeem', WEB, { token: 'nope' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.setCookie).toEqual([]);
  });

  it('authenticates a GET with the cookie alone', async () => {
    const cookie = pair((await login(WEB)).setCookie);
    const me = await call('GET', '/api/auth/me', { Cookie: cookie });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('ann@example.com');
    expect((await call('GET', '/api/auth/me')).status).toBe(401);
  });

  it('refuses an unsafe cookie request from the wrong or no origin, accepts the right one', async () => {
    const cookie = pair((await login(WEB)).setCookie);
    const post = (headers: Record<string, string>) =>
      call('POST', '/api/auth/consent', { Cookie: cookie, ...headers }, { version: '1' });
    const none = await post({});
    expect(none.status).toBe(403);
    expect(none.body.error).toBe('csrf');
    expect((await post({ Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ Origin: 'null' })).status).toBe(403);
    expect((await post({ Referer: 'https://evil.example/page' })).status).toBe(403);
    expect((await post({ Origin: base })).status).toBe(200);
    // no Origin but a same-origin Referer is accepted
    expect((await post({ Referer: `${base}/download` })).status).toBe(200);
  });

  it('derives the expected origin from the forwarded scheme and host', async () => {
    const cookie = pair((await login({ ...WEB, ...HTTPS })).setCookie);
    const headers = { Cookie: cookie, ...HTTPS };
    const post = (origin: string) =>
      call('POST', '/api/auth/consent', { ...headers, Origin: origin }, { version: '1' });
    expect((await post(base)).status).toBe(403); // http origin, https request
    expect((await post(base.replace('http', 'https'))).status).toBe(200);
  });

  it('only reads the cookie name that fits the scheme', async () => {
    const cookie = pair((await login(WEB)).setCookie);
    const prefixed = cookie.replace('vtt_session', '__Host-vtt_session');
    expect((await call('GET', '/api/auth/me', { Cookie: prefixed })).status).toBe(401);
    expect((await call('GET', '/api/auth/me', { Cookie: cookie, ...HTTPS })).status).toBe(401);
  });

  it('leaves Bearer clients unchanged (no Origin needed) and lets Bearer win over a cookie', async () => {
    const bearer = (await login({})).body.sessionToken as string;
    const authz = { Authorization: `Bearer ${bearer}` };
    expect((await call('POST', '/api/auth/consent', authz, { version: '1' })).status).toBe(200);

    await register('bob');
    const bobCookie = pair((await login(WEB, 'bob')).setCookie);
    const both = await call('GET', '/api/auth/me', { ...authz, Cookie: bobCookie });
    expect(both.body.user.email).toBe('ann@example.com');
    // a bad Bearer is not rescued by a good cookie
    const bad = await call('GET', '/api/auth/me', {
      Authorization: 'Bearer x.y',
      Cookie: bobCookie,
    });
    expect(bad.status).toBe(401);
  });

  it('logout revokes the session and clears the cookie', async () => {
    const cookie = pair((await login(WEB)).setCookie);
    const out = await call('POST', '/api/auth/logout', { Cookie: cookie, Origin: base });
    expect(out.status).toBe(204);
    expect(out.setCookie[0]).toMatch(
      /^vtt_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=/,
    );
    const after = await call('GET', '/api/auth/me', { Cookie: cookie });
    expect(after.status).toBe(401);
    expect(after.setCookie[0]).toMatch(/Max-Age=0/); // a dead cookie is told to go away
  });

  it('answers 401 for a revoked session or an expired one', async () => {
    const cookie = pair((await login(WEB)).setCookie);
    const sessions = await store.listSessionsForUser(
      (await store.getUserByEmail('ann@example.com'))!.id,
    );
    for (const session of sessions) await store.putSession({ ...session, revokedAt: Date.now() });
    expect((await call('GET', '/api/auth/me', { Cookie: cookie })).status).toBe(401);
  });
});

describe('sliding lifetime', () => {
  beforeEach(() => register());
  const ageSessions = async (ms: number) => {
    const user = (await store.getUserByEmail('ann@example.com'))!;
    for (const session of await store.listSessionsForUser(user.id)) {
      await store.putSession({ ...session, lastSeenAt: Date.now() - ms });
    }
  };

  it('uses the operator offline limit as Max-Age, and new cookies follow a change', async () => {
    await store.putSettings({ ...(await store.getSettings()), offlineLimitDays: 7 });
    expect((await login(WEB)).setCookie[0]).toMatch(/Max-Age=604800$/);
  });

  it('re-issues the cookie with a fresh Max-Age on every /api/auth/me', async () => {
    const cookie = pair((await login(WEB)).setCookie);
    const first = await call('GET', '/api/auth/me', { Cookie: cookie });
    const second = await call('GET', '/api/auth/me', { Cookie: cookie });
    for (const res of [first, second]) {
      expect(res.setCookie).toHaveLength(1);
      expect(res.setCookie[0]).toMatch(
        new RegExp(`^${cookie.replace('.', '\\.')}; .*Max-Age=2592000$`),
      );
    }
  });

  it('refreshes other calls at most about hourly', async () => {
    const cookie = pair((await login(WEB)).setCookie);
    const get = () => call('GET', '/api/downloads', { Cookie: cookie });
    expect((await get()).setCookie).toHaveLength(0); // just signed in
    await ageSessions(2 * 3600_000);
    expect((await get()).setCookie).toHaveLength(1); // stale: slides
    expect((await get()).setCookie).toHaveLength(0); // seen a moment ago: no Set-Cookie
  });

  it('never sets a cookie for a Bearer client', async () => {
    const token = (await login({})).body.sessionToken as string;
    const res = await call('GET', '/api/auth/me', { Authorization: `Bearer ${token}` });
    expect(res.setCookie).toEqual([]);
  });
});

describe('offline expiry', () => {
  it('answers 401 once the session has been offline too long', async () => {
    await register();
    const cookie = pair((await login(WEB)).setCookie);
    const user = (await store.getUserByEmail('ann@example.com'))!;
    const sessions = await store.listSessionsForUser(user.id);
    for (const session of sessions)
      await store.putSession({ ...session, lastSeenAt: Date.now() - 400 * 24 * 3600_000 });
    const res = await call('GET', '/api/auth/me', { Cookie: cookie });
    expect(res.status).toBe(401);
    expect(res.setCookie[0]).toMatch(/Max-Age=0/);
  });
});

describe('cookie helpers', () => {
  it('reads one cookie out of several', () => {
    expect(readCookie('a=1; vtt_session=tok.en; b=2', 'vtt_session')).toBe('tok.en');
    expect(readCookie('a=1', 'vtt_session')).toBeUndefined();
    expect(readCookie(undefined, 'x')).toBeUndefined();
    expect(readCookie('vtt_session=', 'vtt_session')).toBeUndefined();
  });

  it('checks origin only for unsafe methods', () => {
    expect(sameOrigin('GET', undefined, undefined, 'https://a.test')).toBe(true);
    expect(sameOrigin('PUT', undefined, undefined, 'https://a.test')).toBe(false);
    expect(sameOrigin('DELETE', 'https://a.test', undefined, 'https://a.test')).toBe(true);
    expect(sameOrigin('PATCH', 'https://a.test:8443', undefined, 'https://a.test')).toBe(false);
  });
});
