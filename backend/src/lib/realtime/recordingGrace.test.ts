/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON frames */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { AccountService } from '../auth/accountService.js';
import { openTestBackend } from '../store/testing.js';
import { Hub, type Connection } from './hub.js';
import { MemoryReplayBuffer } from './replayBuffer.js';

const backend = await openTestBackend();
afterAll(() => backend.close());

const GRACE_MS = 60;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Conn implements Connection {
  sent: { t: string; d: any }[] = [];
  constructor(readonly id: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {}
}
const frame = (t: string, d: unknown): string => JSON.stringify({ v: 1, t, d });

let server: Server;
let base: string;
let hub: Hub;
let tokens: Record<string, string>;
let campaignId: string;
let ids: Record<string, string>;

async function rest(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`http://${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

beforeEach(async () => {
  const store = await backend.reset();
  hub = new Hub({
    store,
    accounts: new AccountService({ store }),
    replay: new MemoryReplayBuffer(),
    recordingGraceMs: GRACE_MS,
  });
  server = createServer(
    createApp({
      config: {
        port: 0,
        liveKitUrl: 'ws://lk.test',
        liveKitApiKey: 'k',
        liveKitApiSecret: 'testsecret-testsecret-testsecret-1234',
        recordingGraceSeconds: GRACE_MS / 1000,
      } as any,
      store,
      realtime: hub,
      recording: hub.recording,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  tokens = {};
  ids = {};
  for (const name of ['dm', 'alice', 'bob']) {
    const r = await rest('POST', '/api/auth/register', undefined, {
      email: `${name}@example.com`,
      displayName: name,
      password: 'correct horse battery',
      acceptedConsentVersion: '1',
    });
    tokens[name] = r.body.sessionToken;
    ids[name] = r.body.user.id;
  }
  campaignId = (await rest('POST', '/api/campaigns', tokens.dm, { name: 'T' })).body.campaign.id;
  const { code } = (await rest('POST', `/api/campaigns/${campaignId}/invites`, tokens.dm, {})).body;
  for (const p of ['alice', 'bob']) await rest('POST', '/api/campaigns/join', tokens[p], { code });
});
afterEach(async () => {
  hub.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function connect(id: string, who: string): Promise<Conn> {
  const conn = new Conn(id);
  hub.accept(conn);
  await hub.receive(id, frame('auth', { token: tokens[who] }));
  await hub.receive(id, frame('resume', { campaignId }));
  return conn;
}
const control = (who: string, action: string) =>
  rest('POST', `/api/campaigns/${campaignId}/recording`, tokens[who], { action });

describe('recording control while the DM is away', () => {
  it('stays with the DM while they are connected, however long the recording runs', async () => {
    await connect('d', 'dm');
    await connect('a', 'alice');
    expect((await control('dm', 'start')).status).toBe(200);
    await sleep(GRACE_MS * 2);
    expect((await control('alice', 'pause')).status).toBe(403);
  });

  it('stays with the DM during the grace period after they drop', async () => {
    await connect('d', 'dm');
    await connect('a', 'alice');
    await control('dm', 'start');
    hub.closed('d');
    expect((await control('alice', 'pause')).status).toBe(403);
  });

  it('opens to any player once the DM has been gone longer than the grace period', async () => {
    await connect('d', 'dm');
    await connect('a', 'alice');
    await connect('b', 'bob');
    await control('dm', 'start');
    hub.closed('d');
    await sleep(GRACE_MS + 40);
    expect((await control('alice', 'pause')).status).toBe(200);
    expect((await control('bob', 'resume')).status).toBe(200);
    expect((await control('bob', 'stop')).status).toBe(200);
  });

  it('never lets a player start a recording, and returns to the DM when they reconnect', async () => {
    await connect('d', 'dm');
    await connect('a', 'alice');
    hub.closed('d');
    await sleep(GRACE_MS + 40);
    expect((await control('alice', 'start')).status).toBe(403);
    // The DM starts one on a fresh connection, then drops and returns inside the grace period.
    await connect('d2', 'dm');
    await control('dm', 'start');
    hub.closed('d2');
    await sleep(GRACE_MS + 40);
    await connect('d3', 'dm');
    expect((await control('alice', 'pause')).status).toBe(403);
  });

  it('refuses someone who is not in the campaign, even when the DM is away', async () => {
    await connect('d', 'dm');
    await control('dm', 'start');
    hub.closed('d');
    await sleep(GRACE_MS + 40);
    const stranger = await rest('POST', '/api/auth/register', undefined, {
      email: 'x@example.com',
      displayName: 'x',
      password: 'correct horse battery',
      acceptedConsentVersion: '1',
    });
    tokens.x = stranger.body.sessionToken;
    expect((await control('x', 'stop')).status).toBe(403);
  });
});

describe('a recording nobody is connected to', () => {
  it('stops by itself once everyone has been gone longer than the grace period', async () => {
    await connect('d', 'dm');
    await connect('a', 'alice');
    await control('dm', 'start');
    hub.closed('d');
    hub.closed('a');
    expect(hub.recording.current(campaignId)).not.toBeNull();
    await sleep(GRACE_MS + 60);
    expect(hub.recording.current(campaignId)).toBeNull();
  });

  it('keeps going if anyone is back inside the grace period', async () => {
    await connect('d', 'dm');
    await control('dm', 'start');
    hub.closed('d');
    await sleep(GRACE_MS / 2);
    await connect('d2', 'dm');
    await sleep(GRACE_MS + 60);
    expect(hub.recording.current(campaignId)).not.toBeNull();
  });

  it('keeps going while a player is still connected, even with the DM gone', async () => {
    await connect('d', 'dm');
    await connect('a', 'alice');
    await control('dm', 'start');
    hub.closed('d');
    await sleep(GRACE_MS + 60);
    expect(hub.recording.current(campaignId)).not.toBeNull();
  });
});

describe('the DM role during a recording', () => {
  it('cannot be swapped until the recording is stopped', async () => {
    await connect('d', 'dm');
    await control('dm', 'start');
    const swap = () =>
      rest('POST', `/api/campaigns/${campaignId}/dm-swap`, tokens.dm, { newDmUserId: ids.alice });
    expect((await swap()).status).toBe(409);
    await control('dm', 'stop');
    expect((await swap()).status).toBe(204);
  });
});
