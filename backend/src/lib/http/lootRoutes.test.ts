/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON bodies */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { BackendConfig } from '../config.js';
import { openTestBackend } from '../store/testing.js';
import { MemoryTableStore } from '../table/memoryTableStore.js';
import { PostgresTableStore } from '../table/postgresTableStore.js';

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
let events: { event: string; id: string; claimedBy: string | null; item: any }[];
let dm: { id: string; token: string };
let alice: { id: string; token: string };
let bob: { id: string; token: string };
let outsider: { id: string; token: string };
let campaign: string;
let other: string;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}
async function person(name: string) {
  const { body } = await call('POST', '/api/auth/register', undefined, {
    email: `${name}@example.com`,
    displayName: name,
    password: 'correct horse battery',
    acceptedConsentVersion: '1',
  });
  return { id: body.user.id as string, token: body.sessionToken as string };
}
const drop = (token: string, body: unknown = { name: 'Potion of Healing' }, c = campaign) =>
  call('POST', `/api/campaigns/${c}/loot`, token, body);
const claim = (token: string, id: string, c = campaign) =>
  call('POST', `/api/campaigns/${c}/loot/${id}/claim`, token, {});

beforeEach(async () => {
  const store = await backend.reset();
  const table =
    backend.kind === 'postgres' && backend.pool
      ? new PostgresTableStore(backend.pool)
      : new MemoryTableStore();
  events = [];
  const app = createApp({
    config: CONFIG,
    store,
    table,
    realtime: {
      revokeSession() {},
      announceRosterChanged() {},
      announceRecording() {},
      announceLoot: (event, item) =>
        events.push({ event, id: item.id, claimedBy: item.claimedBy, item }),
    },
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dm = await person('dm');
  alice = await person('alice');
  bob = await person('bob');
  outsider = await person('outsider');
  campaign = (await call('POST', '/api/campaigns', dm.token, { name: 'A' })).body.campaign.id;
  other = (await call('POST', '/api/campaigns', dm.token, { name: 'B' })).body.campaign.id;
  const { code } = (await call('POST', `/api/campaigns/${campaign}/invites`, dm.token, {})).body;
  for (const p of [alice, bob]) await call('POST', '/api/campaigns/join', p.token, { code });
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('dropping and claiming', () => {
  it('the DM drops loot and every member sees it, with live notice', async () => {
    const r = await drop(dm.token, {
      name: 'Ring of Warmth',
      description: 'Slightly smug.',
      quantity: 1,
    });
    expect(r.status).toBe(201);
    for (const p of [dm, alice, bob]) {
      const list = (await call('GET', `/api/campaigns/${campaign}/loot`, p.token)).body.loot;
      expect(list.map((i: any) => i.name)).toEqual(['Ring of Warmth']);
    }
    expect(events).toMatchObject([{ event: 'dropped', id: r.body.item.id, claimedBy: null }]);
  });

  it('the first player to claim gets it, with who and when recorded; the next is told it is gone', async () => {
    const id = (await drop(dm.token)).body.item.id;
    const first = await claim(alice.token, id);
    expect(first.status).toBe(200);
    expect(first.body.item).toMatchObject({ claimedBy: alice.id });
    expect(first.body.item.claimedAt).toBeGreaterThan(0);
    const second = await claim(bob.token, id);
    expect(second.status).toBe(409);
    const list = (await call('GET', `/api/campaigns/${campaign}/loot`, bob.token)).body.loot;
    expect(list[0].claimedBy).toBe(alice.id);
    expect(events.map((e) => e.event)).toEqual(['dropped', 'claimed']);
    expect(events[1]?.claimedBy).toBe(alice.id);
  });

  it('under a simultaneous grab exactly one player wins — never two, never none', async () => {
    for (let round = 0; round < 5; round += 1) {
      const id = (await drop(dm.token, { name: `Gem ${round}` })).body.item.id;
      const results = await Promise.all([
        claim(alice.token, id),
        claim(bob.token, id),
        claim(alice.token, id),
        claim(bob.token, id),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    }
  });

  it('the DM cannot claim their own drop, and a claimed item stays claimed by the winner', async () => {
    const id = (await drop(dm.token)).body.item.id;
    expect((await claim(dm.token, id)).status).toBe(403);
    await claim(alice.token, id);
    expect((await claim(alice.token, id)).status).toBe(409); // not even the winner twice
  });
});

describe('who may do what', () => {
  it('only the DM drops or removes', async () => {
    expect((await drop(alice.token)).status).toBe(403);
    const id = (await drop(dm.token)).body.item.id;
    expect(
      (await call('DELETE', `/api/campaigns/${campaign}/loot/${id}`, alice.token)).status,
    ).toBe(403);
    expect((await call('DELETE', `/api/campaigns/${campaign}/loot/${id}`, dm.token)).status).toBe(
      204,
    );
    expect((await call('GET', `/api/campaigns/${campaign}/loot`, bob.token)).body.loot).toEqual([]);
    expect(events.at(-1)?.event).toBe('removed');
  });

  it('is closed to non-members and the unauthenticated, and scoped to its own campaign', async () => {
    const id = (await drop(dm.token)).body.item.id;
    expect((await call('GET', `/api/campaigns/${campaign}/loot`, outsider.token)).status).toBe(403);
    expect((await claim(outsider.token, id)).status).toBe(403);
    expect((await call('GET', `/api/campaigns/${campaign}/loot`)).status).toBe(401);
    // A real item id used through another campaign's URL, and a nonsense id, are both just "not found".
    expect((await claim(alice.token, id, other)).status).toBe(403); // alice is not in `other`
    expect((await claim(alice.token, 'not-a-uuid')).status).toBe(404);
    expect((await call('DELETE', `/api/campaigns/${other}/loot/${id}`, dm.token)).status).toBe(404);
  });

  it('validates what is dropped', async () => {
    expect((await drop(dm.token, { name: '' })).status).toBe(400);
    expect((await drop(dm.token, { name: 'x', quantity: 0 })).status).toBe(400);
    expect((await drop(dm.token, { name: 'x', quantity: 1.5 })).status).toBe(400);
    expect((await drop(dm.token, { name: 'x'.repeat(201) })).status).toBe(400);
  });
});

const grab = (token: string, id: string, forWhom?: unknown, c = campaign) =>
  call(
    'POST',
    `/api/campaigns/${c}/loot/${id}/claim`,
    token,
    forWhom === undefined ? {} : { for: forWhom },
  );
const split = (token: string, id: string, body: unknown = {}, c = campaign) =>
  call('POST', `/api/campaigns/${c}/loot/${id}/split`, token, body);
const coins = (amount: number) => drop(dm.token, { name: 'gp', quantity: amount, kind: 'coin' });

describe('grabbing for yourself or for the party', () => {
  it('records who took it and whether it was for themselves or the party; self is the default', async () => {
    const a = (await drop(dm.token, { name: 'Rope' })).body.item.id;
    const b = (await drop(dm.token, { name: 'Lantern' })).body.item.id;
    expect((await grab(alice.token, a)).body.item).toMatchObject({
      claimedBy: alice.id,
      claimedFor: 'self',
    });
    expect((await grab(bob.token, b, 'party')).body.item).toMatchObject({
      claimedBy: bob.id,
      claimedFor: 'party',
    });
    expect(events.at(-1)?.item.claimedFor).toBe('party');
  });

  it('refuses an unknown destination', async () => {
    const id = (await drop(dm.token)).body.item.id;
    expect((await grab(alice.token, id, 'everyone')).status).toBe(400);
  });
});

describe('coin and the party split', () => {
  it('drops coin as its own kind, and an item is an item by default', async () => {
    const c = (await coins(10)).body.item;
    expect(c).toMatchObject({ kind: 'coin', name: 'gp', quantity: 10 });
    expect((await drop(dm.token)).body.item.kind).toBe('item');
  });

  it('splits among every player by default, DM excluded, and records each share', async () => {
    const id = (await coins(10)).body.item.id;
    const r = await split(alice.token, id);
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({ claimedBy: alice.id, claimedFor: 'split' });
    expect(r.body.item.split.remainder).toBe(0);
    const shares = r.body.item.split.shares;
    expect(shares).toHaveLength(2);
    expect(shares.map((s: any) => s.userId).sort()).toEqual([alice.id, bob.id].sort());
    expect(shares.every((s: any) => s.amount === 5)).toBe(true);
    expect(events.at(-1)?.item.split.shares).toHaveLength(2);
  });

  it('keeps the remainder in the pool when the amount does not divide evenly', async () => {
    const id = (await coins(7)).body.item.id;
    const r = await split(alice.token, id);
    expect(r.body.item.split.shares.map((s: any) => s.amount)).toEqual([3, 3]);
    expect(r.body.item.split.remainder).toBe(1);
  });

  it('splits among a chosen subset, and the DM may split too', async () => {
    const id = (await coins(9)).body.item.id;
    const r = await split(dm.token, id, { userIds: [bob.id] });
    expect(r.status).toBe(200);
    expect(r.body.item.split.shares).toEqual([{ userId: bob.id, amount: 9 }]);
    expect(r.body.item.claimedBy).toBe(dm.id);
  });

  it('refuses a split of a non-coin item, the DM or a stranger as recipient, an empty list, and non-members', async () => {
    const item = (await drop(dm.token)).body.item.id;
    expect((await split(alice.token, item)).status).toBe(400);
    const id = (await coins(10)).body.item.id;
    expect((await split(alice.token, id, { userIds: [dm.id] })).status).toBe(400);
    expect((await split(alice.token, id, { userIds: [outsider.id] })).status).toBe(400);
    expect((await split(alice.token, id, { userIds: [] })).status).toBe(400);
    expect((await split(outsider.token, id)).status).toBe(403);
    expect((await split(alice.token, 'not-a-uuid')).status).toBe(404);
  });

  it('can only happen once, and never after someone grabbed the coin', async () => {
    const id = (await coins(10)).body.item.id;
    expect((await split(alice.token, id)).status).toBe(200);
    expect((await split(bob.token, id)).status).toBe(409);
    expect((await grab(bob.token, id)).status).toBe(409);
    const other2 = (await coins(4)).body.item.id;
    await grab(bob.token, other2, 'party');
    expect((await split(alice.token, other2)).status).toBe(409);
  });

  it('under a simultaneous grab and split exactly one wins', async () => {
    const id = (await coins(10)).body.item.id;
    const results = await Promise.all([
      grab(alice.token, id),
      split(bob.token, id),
      split(alice.token, id),
      grab(bob.token, id, 'party'),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });
});
