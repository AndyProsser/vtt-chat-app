import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { jwtVerify } from 'jose';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { Store } from '../store/store.js';
import { openTestBackend } from '../store/testing.js';
import type { MagicLinkMessage, MagicLinkSender } from './delivery.js';
import { RateLimiter } from './rateLimit.js';

class CapturingSender implements MagicLinkSender {
  messages: MagicLinkMessage[] = [];
  async send(message: MagicLinkMessage): Promise<void> {
    this.messages.push(message);
  }
}

const CONFIG = {
  port: 0,
  liveKitUrl: 'ws://livekit.test',
  liveKitApiKey: 'testkey',
  liveKitApiSecret: 'testsecret-testsecret-testsecret-1234',
};

// Responses are checked field by field in the tests, so a loose JSON shape is the honest type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

interface Api {
  call(
    method: string,
    path: string,
    options?: { token?: string; body?: unknown; raw?: string },
  ): Promise<{ status: number; body: Json }>;
}

let server: Server;
const backend = await openTestBackend();
afterAll(() => backend.close());
let store: Store;
let sender: CapturingSender;
let api: Api;
let base: string;

beforeEach(async () => {
  store = await backend.reset();
  sender = new CapturingSender();
  const app = createApp({ config: CONFIG, store, sender });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  api = {
    async call(method, path, options = {}) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(options.body !== undefined || options.raw !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        ...(options.raw !== undefined
          ? { body: options.raw }
          : options.body !== undefined
            ? { body: JSON.stringify(options.body) }
            : {}),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : undefined };
    },
  };
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const PASSWORD = 'correct horse battery';

async function signUp(name: string): Promise<{ token: string; id: string }> {
  const res = await api.call('POST', '/api/auth/register', {
    body: {
      email: `${name}@example.com`,
      displayName: name,
      password: PASSWORD,
      acceptedConsentVersion: '1',
    },
  });
  expect(res.status).toBe(201);
  return { token: res.body.sessionToken, id: res.body.user.id };
}

describe('sign-in options', () => {
  it('tells the sign-in screen which consent notice version to ask for', async () => {
    const { status, body } = await api.call('GET', '/api/auth/providers');
    expect(status).toBe(200);
    expect(body.consentVersion).toBe((await store.getSettings()).consentVersion);
  });
});

describe('health and hardening', () => {
  it('answers health without auth and sets safe headers', async () => {
    const res = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects malformed JSON and invalid bodies with 400, not 500', async () => {
    expect((await api.call('POST', '/api/auth/login', { raw: '{nope' })).status).toBe(400);
    const bad = await api.call('POST', '/api/auth/register', { body: { email: 1 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_input');
  });

  it('rejects oversize bodies', async () => {
    const res = await api.call('POST', '/api/auth/login', {
      body: { email: 'a@b.co', password: 'x'.repeat(200_000) },
    });
    expect(res.status).toBe(413);
  });
});

describe('accounts over HTTP', () => {
  it('registers, never leaks the password hash, and signs in', async () => {
    const res = await api.call('POST', '/api/auth/register', {
      body: {
        email: 'Ann@Example.com',
        displayName: 'Ann',
        password: PASSWORD,
        acceptedConsentVersion: '1',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'ann@example.com', isAdmin: true });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);

    const login = await api.call('POST', '/api/auth/login', {
      body: { email: 'ann@example.com', password: PASSWORD, deviceLabel: 'desktop' },
    });
    expect(login.status).toBe(200);
    expect(login.body.needsConsent).toBe(false);

    const me = await api.call('GET', '/api/auth/me', { token: login.body.sessionToken });
    expect(me.status).toBe(200);
    expect(me.body.user.displayName).toBe('Ann');
  });

  it('lets someone change their own display name, and only to a sensible one', async () => {
    const ann = await signUp('ann');
    const renamed = await api.call('PATCH', '/api/auth/me', {
      token: ann.token,
      body: { displayName: '  Annie  ' },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.user.displayName).toBe('Annie');
    const me = await api.call('GET', '/api/auth/me', { token: ann.token });
    expect(me.body.user.displayName).toBe('Annie');
    for (const bad of ['', '   ', 'x'.repeat(81)]) {
      const res = await api.call('PATCH', '/api/auth/me', {
        token: ann.token,
        body: { displayName: bad },
      });
      expect(res.status).toBe(400);
    }
    expect(
      (await api.call('PATCH', '/api/auth/me', { body: { displayName: 'Nobody' } })).status,
    ).toBe(401);
  });

  it('keeps a person portrait, accepting only uploaded pictures and emblems', async () => {
    const ann = await signUp('ann');
    const id = '0b1f3a52-6c1e-4d57-9a64-0c2f7d3e8a11';
    const set = (avatarUrl: string | null) =>
      api.call('PATCH', '/api/auth/me', { token: ann.token, body: { avatarUrl } });
    expect((await set(`avatar:${id}`)).body.user.avatarUrl).toBe(`avatar:${id}`);
    expect((await api.call('GET', '/api/auth/me', { token: ann.token })).body.user.avatarUrl).toBe(
      `avatar:${id}`,
    );
    expect((await set('emblem:crown')).status).toBe(200);
    expect((await set('javascript:alert(1)')).status).toBe(400);
    expect((await set('https://x.test/a.png')).status).toBe(400);
    const cleared = await set(null);
    expect(cleared.body.user.avatarUrl).toBeNull();
    // A name-only change leaves the portrait alone.
    await set('emblem:gem');
    const renamed = await api.call('PATCH', '/api/auth/me', {
      token: ann.token,
      body: { displayName: 'Annie' },
    });
    expect(renamed.body.user).toMatchObject({ displayName: 'Annie', avatarUrl: 'emblem:gem' });
  });

  it('refuses registration without the current consent text', async () => {
    const res = await api.call('POST', '/api/auth/register', {
      body: { email: 'a@b.co', displayName: 'A', acceptedConsentVersion: 'old' },
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('consent_required');
  });

  it('requires a valid session for protected routes', async () => {
    expect((await api.call('GET', '/api/auth/me')).status).toBe(401);
    expect((await api.call('GET', '/api/auth/me', { token: 'bogus.token' })).status).toBe(401);
    expect((await api.call('GET', '/api/campaigns')).status).toBe(401);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    await signUp('ann');
    const wrong = await api.call('POST', '/api/auth/login', {
      body: { email: 'ann@example.com', password: 'not the password' },
    });
    const unknown = await api.call('POST', '/api/auth/login', {
      body: { email: 'ghost@example.com', password: 'not the password' },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('locks out repeated bad logins, then allows a correct one only after the window', async () => {
    await signUp('ann');
    let last = 0;
    for (let i = 0; i < 12; i += 1) {
      last = (
        await api.call('POST', '/api/auth/login', {
          body: { email: 'ann@example.com', password: 'wrong wrong wrong' },
        })
      ).status;
    }
    expect(last).toBe(429);
    const correct = await api.call('POST', '/api/auth/login', {
      body: { email: 'ann@example.com', password: PASSWORD },
    });
    expect(correct.status).toBe(429);
  });

  it('logs out and revokes remotely', async () => {
    const { token } = await signUp('ann');
    const second = (
      await api.call('POST', '/api/auth/login', {
        body: { email: 'ann@example.com', password: PASSWORD, deviceLabel: 'phone' },
      })
    ).body.sessionToken as string;

    const list = await api.call('GET', '/api/auth/sessions', { token });
    expect(list.body.sessions).toHaveLength(2);
    const phone = list.body.sessions.find(
      (s: { deviceLabel: string }) => s.deviceLabel === 'phone',
    );
    expect(phone.current).toBe(false);

    expect((await api.call('DELETE', `/api/auth/sessions/${phone.id}`, { token })).status).toBe(
      204,
    );
    expect((await api.call('GET', '/api/auth/me', { token: second })).status).toBe(401);
    expect((await api.call('POST', '/api/auth/logout', { token })).status).toBe(204);
    expect((await api.call('GET', '/api/auth/me', { token })).status).toBe(401);
  });

  it('never returns the magic-link token; it only goes to the sender', async () => {
    await signUp('ann');
    const res = await api.call('POST', '/api/auth/magic-link', {
      body: { email: 'ann@example.com', purpose: 'signin' },
    });
    expect(res.status).toBe(202);
    expect(JSON.stringify(res.body)).not.toContain(sender.messages[0]?.token ?? 'x');
    expect(sender.messages).toHaveLength(1);

    const redeem = await api.call('POST', '/api/auth/magic-link/redeem', {
      body: { token: sender.messages[0]?.token },
    });
    expect(redeem.status).toBe(200);
    expect(
      (await api.call('GET', '/api/auth/me', { token: redeem.body.sessionToken })).status,
    ).toBe(200);
  });

  it('issues a link code only to a signed-in session, and it signs in a new session', async () => {
    const ann = await signUp('ann');
    expect((await api.call('POST', '/api/auth/link-codes')).status).toBe(401);
    const res = await api.call('POST', '/api/auth/link-codes', { token: ann.token });
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const redeem = await api.call('POST', '/api/auth/magic-link/redeem', {
      body: { token: res.body.code },
    });
    expect(redeem.status).toBe(200);
    expect(redeem.body.sessionToken).not.toBe(ann.token);
    expect(redeem.body.user.id).toBe(ann.id);
    // the long token for the deep link is a second, independent credential
    expect(res.body.linkToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const viaToken = await api.call('POST', '/api/auth/magic-link/redeem', {
      body: { token: res.body.linkToken },
    });
    expect(viaToken.status).toBe(200);
    expect(viaToken.body.user.id).toBe(ann.id);
  });

  it('serves GET /api/downloads from the synced file unless CLIENT_URL_* is set', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(`${tmpdir()}/dl-`);
    await writeFile(
      `${dir}/downloads.json`,
      JSON.stringify({ linux: 'https://dl.test/a.AppImage' }),
    );
    const ann = await signUp('ann');
    const serve = async (config: object) => {
      const app = createApp({ config: { ...CONFIG, ...config } as never, store, sender });
      const srv = await new Promise<Server>((resolve) => {
        const s2 = app.listen(0, '127.0.0.1', () => resolve(s2));
      });
      try {
        const port = (srv.address() as AddressInfo).port;
        const url = `http://127.0.0.1:${port}/api/downloads`;
        expect((await fetch(url)).status).toBe(401);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${ann.token}` } });
        expect(res.status).toBe(200);
        return res.json();
      } finally {
        srv.close();
      }
    };
    expect(await serve({ clientDownloads: {}, updatesDir: dir })).toEqual({
      linux: 'https://dl.test/a.AppImage',
    });
    expect(
      await serve({ clientDownloads: { windows: 'https://mine/w' }, updatesDir: dir }),
    ).toEqual({ windows: 'https://mine/w' });
    expect(await serve({ clientDownloads: {} })).toEqual({});
  });

  it('answers an unknown address exactly like a known one, and sends nothing', async () => {
    const res = await api.call('POST', '/api/auth/magic-link', {
      body: { email: 'ghost@example.com', purpose: 'reset' },
    });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    expect(sender.messages).toHaveLength(0);
  });
});

describe('campaigns over HTTP', () => {
  it('runs the whole flow: create, invite, join, character, swap, voice token', async () => {
    const dm = await signUp('dm'); // first account = Admin, may create campaigns while closed
    const player = await signUp('player');

    const created = await api.call('POST', '/api/campaigns', {
      token: dm.token,
      body: { name: 'Lost Mine' },
    });
    expect(created.status).toBe(201);
    const campaignId = created.body.campaign.id as string;

    const invite = await api.call('POST', `/api/campaigns/${campaignId}/invites`, {
      token: dm.token,
      body: {},
    });
    expect(invite.status).toBe(201);

    const joined = await api.call('POST', '/api/campaigns/join', {
      token: player.token,
      body: { code: invite.body.code },
    });
    expect(joined.status).toBe(201);
    expect(joined.body.membership.role).toBe('player');

    const sheet = await api.call('POST', `/api/campaigns/${campaignId}/characters`, {
      token: player.token,
      body: { name: 'Aria', className: 'Rogue', level: 3 },
    });
    expect(sheet.status).toBe(201);

    // Voice token: identity is the account, the displayed name is the active character.
    const voice = await api.call('POST', `/api/campaigns/${campaignId}/voice-token`, {
      token: player.token,
    });
    expect(voice.status).toBe(200);
    expect(voice.body).toMatchObject({ url: 'ws://livekit.test', roomName: campaignId });
    const { payload } = await jwtVerify(
      voice.body.token,
      new TextEncoder().encode(CONFIG.liveKitApiSecret),
    );
    expect(payload.sub).toBe(player.id);
    expect(payload.name).toBe('Aria');
    expect((payload.video as { room: string }).room).toBe(campaignId);

    // Swap: the player becomes DM and can now create invites; the old DM cannot.
    expect(
      (
        await api.call('POST', `/api/campaigns/${campaignId}/dm-swap`, {
          token: dm.token,
          body: { newDmUserId: player.id },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await api.call('POST', `/api/campaigns/${campaignId}/invites`, {
          token: player.token,
          body: {},
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await api.call('POST', `/api/campaigns/${campaignId}/invites`, {
          token: dm.token,
          body: {},
        })
      ).status,
    ).toBe(403);

    const mine = await api.call('GET', '/api/campaigns', { token: dm.token });
    // The first Admin also has a starter campaign, so look the campaign up by id.
    const swapped = mine.body.campaigns.find(
      (c: { campaign: { id: string } }) => c.campaign.id === campaignId,
    );
    expect(swapped.role).toBe('player');
  });

  it('refuses a voice token to anyone outside the campaign', async () => {
    const dm = await signUp('dm');
    const outsider = await signUp('outsider');
    const campaignId = (
      await api.call('POST', '/api/campaigns', { token: dm.token, body: { name: 'Private' } })
    ).body.campaign.id as string;

    expect(
      (
        await api.call('POST', `/api/campaigns/${campaignId}/voice-token`, {
          token: outsider.token,
        })
      ).status,
    ).toBe(403);
    expect(
      (await api.call('GET', `/api/campaigns/${campaignId}/members`, { token: outsider.token }))
        .status,
    ).toBe(403);
  });

  it('keeps campaign creation closed to non-admins until the instance opens it', async () => {
    await signUp('admin');
    const player = await signUp('player');
    expect(
      (await api.call('POST', '/api/campaigns', { token: player.token, body: { name: 'Nope' } }))
        .status,
    ).toBe(403);

    await store.putSettings({ ...(await store.getSettings()), campaignCreation: 'open' });
    expect(
      (await api.call('POST', '/api/campaigns', { token: player.token, body: { name: 'Yes' } }))
        .status,
    ).toBe(201);
  });

  it('rejects a bad invite code with 400 and does not reveal which part was wrong', async () => {
    const { token } = await signUp('ann');
    const res = await api.call('POST', '/api/campaigns/join', {
      token,
      body: { code: 'NOPENOPE12' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invite_invalid');
  });
});

describe('chat history over HTTP', () => {
  it('serves members the table’s chat plus only their own whispers, and nobody else anything', async () => {
    const dm = await signUp('dm');
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const outsider = await signUp('outsider');
    const campaign = (
      await api.call('POST', '/api/campaigns', { token: dm.token, body: { name: 'T' } })
    ).body.campaign.id;
    const { code } = (
      await api.call('POST', `/api/campaigns/${campaign}/invites`, { token: dm.token, body: {} })
    ).body;
    for (const p of [alice, bob]) {
      await api.call('POST', '/api/campaigns/join', { token: p.token, body: { code } });
    }
    const line = (to: string | null, text: string, at: number) =>
      store.putChatMessage({
        id: backend.newId(),
        campaignId: campaign,
        senderId: alice.id,
        senderName: 'alice',
        recipientId: to,
        text,
        at,
        kind: 'chat',
      });
    await line(null, 'for everyone', 1000);
    await line(dm.id, 'for the DM', 2000);

    const texts = async (token: string) =>
      (await api.call('GET', `/api/campaigns/${campaign}/chat`, { token })).body.messages.map(
        (m: { text: string }) => m.text,
      );
    expect(await texts(alice.token)).toEqual(['for everyone', 'for the DM']);
    expect(await texts(dm.token)).toEqual(['for everyone', 'for the DM']);
    expect(await texts(bob.token)).toEqual(['for everyone']);
    expect(
      (await api.call('GET', `/api/campaigns/${campaign}/chat`, { token: outsider.token })).status,
    ).toBe(403);
    expect((await api.call('GET', `/api/campaigns/${campaign}/chat`)).status).toBe(401);
    const paged = await api.call('GET', `/api/campaigns/${campaign}/chat?before=2000&limit=5`, {
      token: alice.token,
    });
    expect(paged.body.messages.map((m: { text: string }) => m.text)).toEqual(['for everyone']);
    expect(
      (await api.call('GET', `/api/campaigns/${campaign}/chat?limit=999`, { token: alice.token }))
        .status,
    ).toBe(400);
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit per window, then blocks, then recovers', () => {
    let now = 0;
    const limiter = new RateLimiter(3, 1000, () => now);
    expect([1, 2, 3, 4].map(() => limiter.allow('k'))).toEqual([true, true, true, false]);
    expect(limiter.allow('other')).toBe(true);
    now = 1001;
    expect(limiter.allow('k')).toBe(true);
  });

  it('can be reset for a key', () => {
    const limiter = new RateLimiter(1, 1000, () => 0);
    limiter.allow('k');
    expect(limiter.allow('k')).toBe(false);
    limiter.reset('k');
    expect(limiter.allow('k')).toBe(true);
  });
});

describe('device requests over HTTP', () => {
  it('shows a code, a signed-in browser approves it, the app collects a session once', async () => {
    const ann = await signUp('ann');
    const started = await api.call('POST', '/api/auth/device', {
      body: { deviceLabel: 'Desk PC' },
    });
    expect(started.status).toBe(201);
    expect(started.body.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const poll = { requestId: started.body.requestId, pollSecret: started.body.pollSecret };
    const pending = await api.call('POST', '/api/auth/device/poll', { body: poll });
    expect(pending.status).toBe(202);
    expect(pending.body).toEqual({ pending: true });

    const code = encodeURIComponent(started.body.userCode);
    expect((await api.call('GET', `/api/auth/device/${code}`)).status).toBe(401);
    const info = await api.call('GET', `/api/auth/device/${code}`, { token: ann.token });
    expect(info.status).toBe(200);
    expect(info.body.deviceLabel).toBe('Desk PC');
    expect(typeof info.body.createdAt).toBe('number');
    expect(info.body).toHaveProperty('requestIp');

    const approveBody = { userCode: started.body.userCode };
    expect((await api.call('POST', '/api/auth/device/approve', { body: approveBody })).status).toBe(
      401,
    );
    expect(
      (await api.call('POST', '/api/auth/device/approve', { token: ann.token, body: approveBody }))
        .status,
    ).toBe(204);
    expect(
      (await api.call('POST', '/api/auth/device/approve', { token: ann.token, body: approveBody }))
        .status,
    ).toBe(404);

    const done = await api.call('POST', '/api/auth/device/poll', { body: poll });
    expect(done.status).toBe(200);
    expect(done.body.user.id).toBe(ann.id);
    expect(done.body.needsConsent).toBe(false);
    const me = await api.call('GET', '/api/auth/me', { token: done.body.sessionToken });
    expect(me.body.user.id).toBe(ann.id);

    const again = await api.call('POST', '/api/auth/device/poll', { body: poll });
    expect(again.status).toBe(404);
    expect(again.body.error).toBe('invalid_token');
  });

  it('refuses a link code and a device approval until a changed notice is accepted', async () => {
    const ann = await signUp('ann');
    await store.putSettings({ ...(await store.getSettings()), consentVersion: '2' });
    const link = await api.call('POST', '/api/auth/link-codes', { token: ann.token });
    expect(link.status).toBe(403);
    expect(link.body.error).toBe('consent_required');
    expect(link.body.message).toMatch(/recording notice/);

    const started = await api.call('POST', '/api/auth/device', { body: {} });
    const approveBody = { userCode: started.body.userCode };
    const refused = await api.call('POST', '/api/auth/device/approve', {
      token: ann.token,
      body: approveBody,
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('consent_required');

    await api.call('POST', '/api/auth/consent', { token: ann.token, body: { version: '2' } });
    expect(
      (await api.call('POST', '/api/auth/device/approve', { token: ann.token, body: approveBody }))
        .status,
    ).toBe(204);
    expect((await api.call('POST', '/api/auth/link-codes', { token: ann.token })).status).toBe(200);
  });

  it('answers a wrong secret and an unknown request identically', async () => {
    const started = await api.call('POST', '/api/auth/device', { body: {} });
    const wrong = await api.call('POST', '/api/auth/device/poll', {
      body: { requestId: started.body.requestId, pollSecret: 'nope' },
    });
    const unknown = await api.call('POST', '/api/auth/device/poll', {
      body: { requestId: '00000000-0000-4000-8000-000000000000', pollSecret: 'nope' },
    });
    expect(wrong.status).toBe(404);
    expect(wrong).toEqual(unknown);
  });

  it('lets the app poll every couple of seconds, and stops a flood by address', async () => {
    const started = await api.call('POST', '/api/auth/device', { body: {} });
    const poll = { requestId: started.body.requestId, pollSecret: started.body.pollSecret };
    for (let i = 0; i < 50; i++) {
      expect((await api.call('POST', '/api/auth/device/poll', { body: poll })).status).toBe(202);
    }
    // The budget is 1500 per 5 minutes per address, whatever request id is named (made-up ids
    // count too, so they cannot grow the limiter's key space or dodge it).
    const statuses: number[] = [];
    for (let batch = 0; batch < 15; batch++) {
      const replies = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          api.call('POST', '/api/auth/device/poll', {
            body: {
              requestId: `00000000-0000-4000-8000-${String(batch * 100 + i).padStart(12, '0')}`,
              pollSecret: 'x',
            },
          }),
        ),
      );
      statuses.push(...replies.map((r) => r.status));
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(50);
    expect(statuses.filter((s) => s !== 429 && s !== 404)).toEqual([]);
    expect((await api.call('POST', '/api/auth/device/poll', { body: poll })).status).toBe(429);
  }, 60_000);

  it('caps a long deviceLabel in the body instead of refusing it', async () => {
    const started = await api.call('POST', '/api/auth/device', {
      body: { deviceLabel: 'z'.repeat(500) },
    });
    expect(started.status).toBe(201);
    const row = await store.getDeviceRequest(started.body.requestId);
    expect(row?.deviceLabel).toBe('z'.repeat(80));
    await signUp('ann');
    const login = await api.call('POST', '/api/auth/login', {
      body: { email: 'ann@example.com', password: PASSWORD, deviceLabel: 'w'.repeat(500) },
    });
    expect(login.status).toBe(200);
  });

  it('caps a long x-device-label header, here and on sign-in sessions', async () => {
    const response = await fetch(`${base}/api/auth/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-label': 'y'.repeat(5000) },
      body: '{}',
    });
    const started = (await response.json()) as Json;
    const row = await store.getDeviceRequest(started.requestId);
    expect(row?.deviceLabel).toBe('y'.repeat(80));
  });

  it('rate-limits starting requests by address', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await api.call('POST', '/api/auth/device', { body: {} })).status;
    }
    expect(last).toBe(429);
  });
});

describe('sign-up requests over HTTP', () => {
  const ask = (body: unknown) => api.call('POST', '/api/signup-requests', { body });
  const turnOn = async (): Promise<void> =>
    store.putSettings({ ...(await store.getSettings()), signupRequests: 'on' });

  it('is not there while the setting is off, and the providers say so', async () => {
    expect((await api.call('GET', '/api/auth/providers')).body.signupRequests).toBe(false);
    const { status, body } = await ask({ email: 'a@x.test', displayName: 'A' });
    expect(status).toBe(404);
    expect(body.error).toBe('not_found');
    expect(await store.listSignupRequests()).toEqual([]);
  });

  it('takes a request when on, answering the same for a repeat or an existing account', async () => {
    await turnOn();
    expect((await api.call('GET', '/api/auth/providers')).body.signupRequests).toBe(true);
    await api.call('POST', '/api/auth/register', {
      body: {
        email: 'have@x.test',
        displayName: 'Have',
        password: 'correct horse battery',
        acceptedConsentVersion: '1',
      },
    });
    const first = await ask({ email: 'new@x.test', displayName: 'New', message: 'hi' });
    const repeat = await ask({ email: 'new@x.test', displayName: 'New' });
    const existing = await ask({ email: 'have@x.test', displayName: 'Have' });
    for (const r of [first, repeat, existing]) {
      expect(r.status).toBe(202);
      expect(r.body).toEqual({ ok: true });
    }
    expect((await store.listSignupRequests()).map((r) => r.email)).toEqual(['new@x.test']);
  });

  it('rejects bad input', async () => {
    await turnOn();
    expect((await ask({ email: 'nope', displayName: 'A' })).status).toBe(400);
    expect((await ask({ email: 'a@x.test' })).status).toBe(400);
    expect(
      (await ask({ email: 'a@x.test', displayName: 'A', message: 'm'.repeat(501) })).status,
    ).toBe(400);
  });

  it('limits requests per address', async () => {
    await turnOn();
    let last = 0;
    for (let i = 0; i < 6; i += 1) {
      last = (await ask({ email: `p${i}@x.test`, displayName: 'P' })).status;
    }
    expect(last).toBe(429);
  });
});
