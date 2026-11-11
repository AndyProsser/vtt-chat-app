import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { BackendConfig } from '../config.js';
import { MemoryScheduleStore } from '../schedule/memoryScheduleStore.js';
import { openTestBackend } from '../store/testing.js';

const backend = await openTestBackend();
afterAll(() => backend.close());

const CONFIG: BackendConfig = {
  port: 0,
  liveKitUrl: 'ws://lk.test',
  liveKitApiKey: 'k',
  liveKitApiSecret: 's',
  databaseUrl: undefined,
  valkeyUrl: undefined,
  recordingsDir: undefined,
  mediaDir: undefined,
  liveKitApiUrl: 'http://lk.test',
  webDir: undefined,
  clientDownloads: {},
};

let server: Server;
let base: string;
let admin: string; // the first account: Admin, and not the DM of the campaign below
let dm: string;
let member: string;
let asker: string;
let campaign: string;
let schedule: MemoryScheduleStore;
let frames: { to: string; type: string; data: Record<string, unknown> }[];
let rosters: string[];
const ids: Record<string, string> = {};

async function call(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function register(name: string): Promise<string> {
  const { body } = await call('POST', '/api/auth/register', undefined, {
    email: `${name}@example.com`,
    displayName: name,
    password: 'correct horse battery',
    acceptedConsentVersion: '1',
  });
  ids[name] = body.user.id;
  return body.sessionToken;
}

beforeEach(async () => {
  const store = await backend.reset();
  schedule = new MemoryScheduleStore();
  frames = [];
  rosters = [];
  const app = createApp({
    config: CONFIG,
    store,
    schedule,
    realtime: {
      revokeSession: () => undefined,
      announceRosterChanged: (id) => void rosters.push(id),
      announceRecording: () => undefined,
      sendToUser: (to, type, data) => frames.push({ to, type, data }),
    },
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await register('admin');
  dm = await register('dm');
  member = await register('member');
  asker = await register('asker');
  await store.putSettings({ ...(await store.getSettings()), campaignCreation: 'open' });
  campaign = (await call('POST', '/api/campaigns', dm, { name: 'Strahd' })).body.campaign.id;
  const invite = (await call('POST', `/api/campaigns/${campaign}/invites`, dm, {})).body;
  await call('POST', '/api/campaigns/join', member, { code: invite.code });
  rosters = [];
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** The directory as `token` sees it, limited to the test campaign (the Admin's starter campaign is listed too). */
const listed = async (token: string) =>
  ((await call('GET', '/api/campaigns/open', token)).body.campaigns as { id: string }[]).filter(
    (c) => c.id === campaign,
  ) as Record<string, unknown>[];

const requests = async () =>
  (await call('GET', `/api/campaigns/${campaign}/join-requests`, dm)).body;

describe('GET /api/campaigns/open', () => {
  it('needs a sign-in', async () => {
    expect((await call('GET', '/api/campaigns/open')).status).toBe(401);
  });

  it('lists the campaign for a non-member, without member names, and not for a member', async () => {
    const res = await call('GET', '/api/campaigns/open', asker);
    expect(res.status).toBe(200);
    expect(await listed(asker)).toEqual([
      { id: campaign, name: 'Strahd', dmName: 'dm', playerCount: 1, myRequest: null },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('member');
    expect(await listed(member)).toEqual([]);
  });

  it('is empty with the master switch off, and without a campaign whose DM turned Allow join off', async () => {
    expect(
      (await call('PATCH', `/api/campaigns/${campaign}`, dm, { allowJoin: false })).body.campaign
        .allowJoin,
    ).toBe(false);
    expect(await listed(asker)).toEqual([]);
    await call('PATCH', `/api/campaigns/${campaign}`, dm, { allowJoin: true });
    expect(await listed(asker)).toHaveLength(1);
    const store = backend.store;
    await store.putSettings({ ...(await store.getSettings()), campaignDirectory: 'off' });
    expect((await call('GET', '/api/campaigns/open', asker)).body.campaigns).toEqual([]);
  });
});

describe('asking', () => {
  it('answers 202 for a non-member, the same for a repeat, and tells the DM live and in stored notes', async () => {
    const first = await call('POST', `/api/campaigns/${campaign}/join-requests`, asker, {
      message: 'hello',
    });
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ status: 'pending' });
    const again = await call('POST', `/api/campaigns/${campaign}/join-requests`, asker, {});
    expect(again.status).toBe(202);
    expect(again.body).toEqual({ status: 'pending' });

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      to: ids.dm,
      type: 'join.request',
      data: { campaignId: campaign, status: 'pending', userId: ids.asker, message: 'hello' },
    });
    const notes = await schedule.listNotifications(ids.dm!, { unreadOnly: true, limit: 10 });
    expect(notes).toMatchObject([
      {
        kind: 'join_request',
        campaignId: campaign,
        title: 'asker wants to join Strahd',
        data: { userId: ids.asker },
      },
    ]);
    expect((await listed(asker))[0].myRequest).toMatchObject({ status: 'pending' });
  });

  it('works with a cookie session too', async () => {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VTT-Client': 'web' },
      body: JSON.stringify({ email: 'asker@example.com', password: 'correct horse battery' }),
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    expect(cookie).toBeTruthy();
    const res = await fetch(`${base}/api/campaigns/${campaign}/join-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie!, Origin: base },
      body: '{}',
    });
    expect(res.status).toBe(202);
  });

  it('refuses a member (409), a missing campaign (404), long messages (400) and signed-out callers (401)', async () => {
    const path = `/api/campaigns/${campaign}/join-requests`;
    expect((await call('POST', path, member, {})).status).toBe(409);
    expect((await call('POST', path, dm, {})).status).toBe(409);
    expect(
      (
        await call(
          'POST',
          '/api/campaigns/00000000-0000-4000-8000-0000000000ff/join-requests',
          asker,
          {},
        )
      ).status,
    ).toBe(404);
    expect((await call('POST', path, asker, { message: 'x'.repeat(281) })).status).toBe(400);
    expect((await call('POST', path, undefined, {})).status).toBe(401);
  });

  it('refuses requests (404, like a missing campaign) with Allow join off or the master switch off', async () => {
    const path = `/api/campaigns/${campaign}/join-requests`;
    await call('PATCH', `/api/campaigns/${campaign}`, dm, { allowJoin: false });
    expect((await call('POST', path, asker, {})).status).toBe(404);
    await call('PATCH', `/api/campaigns/${campaign}`, dm, { allowJoin: true });
    const store = backend.store;
    await store.putSettings({ ...(await store.getSettings()), campaignDirectory: 'off' });
    expect((await call('POST', path, asker, {})).status).toBe(404);
  });

  it('rate-limits one address', async () => {
    const path = `/api/campaigns/${campaign}/join-requests`;
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call('POST', path, asker, {})).status;
    expect(last).toBe(429);
  });

  it('withdraws', async () => {
    const path = `/api/campaigns/${campaign}/join-requests`;
    await call('POST', path, asker, {});
    expect((await call('DELETE', `${path}/mine`, asker)).status).toBe(204);
    expect((await requests()).requests).toEqual([]);
    expect((await call('DELETE', `${path}/mine`, asker)).status).toBe(204);
    expect((await call('DELETE', `${path}/mine`)).status).toBe(401);
  });
});

describe('the DM’s side', () => {
  const ask = async () => {
    await call('POST', `/api/campaigns/${campaign}/join-requests`, asker, { message: 'hi' });
    return (await requests()).requests[0].id as string;
  };

  it('lists for the DM only: a player, an Admin who is not the DM and a stranger get 403', async () => {
    await ask();
    const path = `/api/campaigns/${campaign}/join-requests`;
    expect((await call('GET', path, dm)).status).toBe(200);
    expect((await requests()).requests[0]).toMatchObject({
      displayName: 'asker',
      message: 'hi',
      status: 'pending',
      closed: false,
    });
    for (const who of [member, admin, asker])
      expect((await call('GET', path, who)).status).toBe(403);
    expect((await call('GET', path)).status).toBe(401);
  });

  it('approves: membership, notification, live frame, roster refresh, once', async () => {
    const id = await ask();
    frames.length = 0;
    const path = `/api/campaigns/${campaign}/join-requests/${id}/decision`;
    for (const who of [member, admin, asker]) {
      expect((await call('POST', path, who, { approve: true })).status).toBe(403);
    }
    expect((await call('POST', path, undefined, { approve: true })).status).toBe(401);
    expect((await call('POST', path, dm, { approve: 'yes' })).status).toBe(400);

    const [a, b] = await Promise.all([
      call('POST', path, dm, { approve: true }),
      call('POST', path, dm, { approve: true }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.request).toEqual({ id, status: 'approved' });
    expect([a.body.joined, b.body.joined].sort()).toEqual([false, true]);

    const mine = (await call('GET', '/api/campaigns', asker)).body.campaigns;
    expect(mine).toMatchObject([{ campaign: { id: campaign }, role: 'player' }]);
    expect(frames).toEqual([
      {
        to: ids.asker,
        type: 'join.decided',
        data: { campaignId: campaign, requestId: id, approved: true },
      },
    ]);
    expect(rosters).toEqual([campaign]);
    const notes = await schedule.listNotifications(ids.asker!, { unreadOnly: true, limit: 10 });
    expect(notes).toMatchObject([
      {
        kind: 'join_decision',
        campaignId: campaign,
        title: "You're in Strahd",
        data: { approved: true },
      },
    ]);
    expect(await listed(asker)).toEqual([]);
  });

  it('declines, and the asker sees it in the directory', async () => {
    const id = await ask();
    const res = await call('POST', `/api/campaigns/${campaign}/join-requests/${id}/decision`, dm, {
      approve: false,
    });
    expect(res.body).toEqual({ request: { id, status: 'declined' }, joined: false });
    expect((await call('GET', '/api/campaigns', asker)).body.campaigns).toEqual([]);
    expect((await listed(asker))[0].myRequest).toMatchObject({
      status: 'declined',
    });
    const notes = await schedule.listNotifications(ids.asker!, { unreadOnly: true, limit: 10 });
    expect(notes[0]).toMatchObject({ kind: 'join_decision', data: { approved: false } });
  });

  it('shows pending requests as closed and refuses approval while Allow join is off', async () => {
    const id = await ask();
    await call('PATCH', `/api/campaigns/${campaign}`, dm, { allowJoin: false });
    const list = await requests();
    expect(list.allowJoin).toBe(false);
    expect(list.requests[0].closed).toBe(true);
    expect(
      (
        await call('POST', `/api/campaigns/${campaign}/join-requests/${id}/decision`, dm, {
          approve: true,
        })
      ).status,
    ).toBe(409);
  });

  it('puts allowJoin on the campaign object members see, and only the DM can change it', async () => {
    const mine = (await call('GET', '/api/campaigns', member)).body.campaigns[0].campaign;
    expect(mine.allowJoin).toBe(true);
    expect(
      (await call('PATCH', `/api/campaigns/${campaign}`, member, { allowJoin: false })).status,
    ).toBe(403);
    expect(
      (await call('PATCH', `/api/campaigns/${campaign}`, admin, { allowJoin: false })).status,
    ).toBe(403);
    expect(
      (await call('PATCH', `/api/campaigns/${campaign}`, dm, { allowJoin: 'no' })).status,
    ).toBe(400);
  });

  it('hands pending requests to the new DM at a swap', async () => {
    const id = await ask();
    const swap = await call('POST', `/api/campaigns/${campaign}/dm-swap`, dm, {
      newDmUserId: ids.member,
    });
    expect(swap.status).toBe(204);
    const path = `/api/campaigns/${campaign}/join-requests`;
    expect((await call('GET', path, dm)).status).toBe(403);
    expect((await call('POST', `${path}/${id}/decision`, dm, { approve: true })).status).toBe(403);
    expect((await call('GET', path, member)).body.requests).toHaveLength(1);
    expect((await call('POST', `${path}/${id}/decision`, member, { approve: true })).status).toBe(
      200,
    );
  });
});
