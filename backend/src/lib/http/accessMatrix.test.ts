import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { MemoryRecordsStore } from '@vtt-chat-app/ai';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { BackendConfig } from '../config.js';
import { MemoryMediaStorage } from '../media/mediaStorage.js';
import { MemorySoundStore } from '../soundboard/memorySoundStore.js';
import { openTestBackend } from '../store/testing.js';
import { MemoryTableStore } from '../table/memoryTableStore.js';
import { MemoryScheduleStore } from '../schedule/memoryScheduleStore.js';

/**
 * The security pass over the REST surface (ROADMAP, "Security-pass tests"): every campaign route
 * is tried by someone signed out, by a signed-in stranger and, where it is the DM's alone, by a
 * player. The answer must be the refusal, whatever the route does with a valid request.
 */
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
let dm: string;
let player: string;
let stranger: string;
let campaign: string;

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
  return body.sessionToken;
}

beforeEach(async () => {
  const store = await backend.reset();
  const app = createApp({
    config: CONFIG,
    store,
    records: new MemoryRecordsStore(),
    table: new MemoryTableStore(),
    media: new MemoryMediaStorage(),
    sounds: new MemorySoundStore(),
    schedule: new MemoryScheduleStore(),
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  dm = await register('dm'); // the first account is the Admin
  player = await register('player');
  stranger = await register('stranger');
  campaign = (await call('POST', '/api/campaigns', dm, { name: 'Strahd' })).body.campaign.id;
  const invite = (await call('POST', `/api/campaigns/${campaign}/invites`, dm, {})).body;
  await call('POST', '/api/campaigns/join', player, { code: invite.code ?? invite.invite?.code });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type Route = [method: string, path: string, body?: unknown];

const ID = '00000000-0000-4000-8000-000000000001';

/** Routes any member may call; strangers and signed-out callers must be turned away. */
const memberRoutes = (c: string): Route[] => [
  ['GET', `/api/campaigns/${c}/members`],
  ['GET', `/api/campaigns/${c}/characters`],
  ['POST', `/api/campaigns/${c}/characters`, { name: 'Zed' }],
  ['GET', `/api/campaigns/${c}/chat`],
  ['POST', `/api/campaigns/${c}/voice-token`],
  ['POST', `/api/campaigns/${c}/leave`],
  ['GET', `/api/campaigns/${c}/recordings`],
  ['GET', `/api/campaigns/${c}/recordings/search?q=hello`],
  ['GET', `/api/campaigns/${c}/recordings/${ID}`],
  ['GET', `/api/campaigns/${c}/recordings/${ID}/transcript`],
  ['GET', `/api/campaigns/${c}/handouts`],
  ['GET', `/api/campaigns/${c}/handouts/${ID}/file`],
  ['GET', `/api/campaigns/${c}/loot`],
  ['POST', `/api/campaigns/${c}/loot/${ID}/claim`],
  ['GET', `/api/campaigns/${c}/sessions`],
  ['GET', `/api/campaigns/${c}/sessions/past`],
  ['PUT', `/api/campaigns/${c}/sessions/${ID}/rsvp`, { status: 'yes' }],
];

/** Routes only the DM may call; a player must be refused too. */
const dmRoutes = (c: string): Route[] => [
  ['POST', `/api/campaigns/${c}/invites`, {}],
  ['DELETE', `/api/campaigns/${c}/invites/ABCD-EFGH`],
  ['POST', `/api/campaigns/${c}/dm-swap`, { newDmUserId: ID }],
  ['POST', `/api/campaigns/${c}/recording`, { action: 'start' }],
  ['DELETE', `/api/campaigns/${c}/recordings/${ID}`],
  ['POST', `/api/campaigns/${c}/recordings/${ID}/audio/delete`],
  ['POST', `/api/campaigns/${c}/handouts`, { title: 'Map', text: 'x' }],
  ['DELETE', `/api/campaigns/${c}/handouts/${ID}`],
  ['POST', `/api/campaigns/${c}/handouts/${ID}/show`, { to: 'all' }],
  ['POST', `/api/campaigns/${c}/handouts/${ID}/hide`, {}],
  ['POST', `/api/campaigns/${c}/loot`, { name: 'Sword' }],
  ['POST', `/api/campaigns/${c}/loot/roll`, { cr: 1, kind: 'individual' }],
  ['POST', `/api/campaigns/${c}/loot/batch`, { items: [] }],
  ['POST', `/api/campaigns/${c}/loot/${ID}/assign`, { userId: ID }],
  ['DELETE', `/api/campaigns/${c}/loot/${ID}`],
  ['POST', `/api/campaigns/${c}/sessions`, { title: 'S1', startsAt: Date.now() + 1e7 }],
  ['PATCH', `/api/campaigns/${c}/sessions/${ID}`, { title: 'S2' }],
  ['DELETE', `/api/campaigns/${c}/sessions/${ID}`],
];

const REFUSED = [401, 403, 404];

describe('every campaign route', () => {
  it('turns away someone who is not signed in', async () => {
    const leaks: string[] = [];
    for (const [method, path, body] of [...memberRoutes(campaign), ...dmRoutes(campaign)]) {
      const res = await call(method, path, undefined, body);
      if (res.status !== 401) leaks.push(`${method} ${path} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('turns away a signed-in person who is not in the campaign', async () => {
    const leaks: string[] = [];
    for (const [method, path, body] of [...memberRoutes(campaign), ...dmRoutes(campaign)]) {
      const res = await call(method, path, stranger, body);
      if (![403, 404].includes(res.status)) leaks.push(`${method} ${path} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('keeps the DM’s controls from a player', async () => {
    const leaks: string[] = [];
    for (const [method, path, body] of dmRoutes(campaign)) {
      const res = await call(method, path, player, body);
      if (![403, 404].includes(res.status)) leaks.push(`${method} ${path} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('answers a stranger exactly as it answers a campaign that does not exist', async () => {
    const ghost = '00000000-0000-4000-8000-0000000000ff';
    const differences: string[] = [];
    for (const [method, path, body] of memberRoutes(campaign)) {
      const real = await call(method, path, stranger, body);
      const missing = await call(method, path.replace(campaign, ghost), stranger, body);
      if (!REFUSED.includes(real.status) || real.status !== missing.status) {
        differences.push(`${method} ${path}: ${real.status} vs ${missing.status}`);
      }
    }
    expect(differences).toEqual([]);
  });
});

describe('access follows the roster as it changes', () => {
  it('lets the DM through the DM’s routes, so the refusals above are about role and not a bad request', async () => {
    const refused: string[] = [];
    for (const [method, path, body] of dmRoutes(campaign)) {
      const res = await call(method, path, dm, body);
      if (res.status === 401 || res.status === 403)
        refused.push(`${method} ${path} -> ${res.status}`);
    }
    expect(refused).toEqual([]);
  });

  it('closes the records, chat and voice to a player who leaves', async () => {
    expect((await call('GET', `/api/campaigns/${campaign}/recordings`, player)).status).toBe(200);
    expect((await call('POST', `/api/campaigns/${campaign}/leave`, player)).status).toBe(204);
    for (const [method, path, body] of memberRoutes(campaign).filter(([m]) => m !== 'POST')) {
      const res = await call(method, path, player, body);
      expect([403, 404], `${method} ${path}`).toContain(res.status);
    }
    expect((await call('POST', `/api/campaigns/${campaign}/voice-token`, player)).status).toBe(403);
  });

  it('hands the DM’s controls to the new DM at a swap, and takes them from the old one', async () => {
    const me = (await call('GET', '/api/auth/me', player)).body.user.id;
    expect(
      (await call('POST', `/api/campaigns/${campaign}/dm-swap`, dm, { newDmUserId: me })).status,
    ).toBe(204);
    expect((await call('POST', `/api/campaigns/${campaign}/invites`, dm, {})).status).toBe(403);
    expect(
      (await call('POST', `/api/campaigns/${campaign}/invites`, player, {})).status,
    ).toBeLessThan(300);
  });
});
