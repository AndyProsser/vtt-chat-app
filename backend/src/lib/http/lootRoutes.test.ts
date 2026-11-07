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
let events: { event: string; id: string; claimedBy: string | null }[];
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
      announceLoot: (event, item) => events.push({ event, id: item.id, claimedBy: item.claimedBy }),
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
    expect(events).toEqual([{ event: 'dropped', id: r.body.item.id, claimedBy: null }]);
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
