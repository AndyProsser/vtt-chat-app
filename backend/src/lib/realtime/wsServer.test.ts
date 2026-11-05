/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON frames */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { AccountService } from '../auth/accountService.js';
import { createApp } from '../app.js';
import { MemoryStore } from '../store/memoryStore.js';
import { Hub } from './hub.js';
import { PROTOCOL_VERSION } from './protocol.js';
import { MemoryReplayBuffer } from './replayBuffer.js';
import { attachWebSocketServer, type WsHandle } from './wsServer.js';

const CONFIG = {
  port: 0,
  liveKitUrl: 'ws://livekit.test',
  liveKitApiKey: 'k',
  liveKitApiSecret: 'testsecret-testsecret-testsecret-1234',
};
const PASSWORD = 'correct horse battery';

let server: Server;
let handle: WsHandle;
let base: string;

beforeEach(async () => {
  const store = new MemoryStore();
  const hub = new Hub({
    store,
    accounts: new AccountService({ store }),
    replay: new MemoryReplayBuffer(),
  });
  server = createServer(createApp({ config: CONFIG, store, realtime: hub }));
  handle = attachWebSocketServer(server, hub);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await handle.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

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

async function signUp(name: string): Promise<string> {
  const res = await rest('POST', '/api/auth/register', undefined, {
    email: `${name}@example.com`,
    displayName: name,
    password: PASSWORD,
    acceptedConsentVersion: '1',
  });
  return res.body.sessionToken as string;
}

interface Client {
  ws: WebSocket;
  frames: any[];
  closed: Promise<{ code: number }>;
  send(t: string, d?: unknown): void;
  waitFor(t: string): Promise<any>;
}

function open(path = '/ws'): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}${path}`);
    const frames: any[] = [];
    const waiters: Array<{ t: string; resolve: (f: any) => void }> = [];
    const closed = new Promise<{ code: number }>((res) => ws.on('close', (code) => res({ code })));
    ws.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      frames.push(frame);
      const index = waiters.findIndex((w) => w.t === frame.t);
      if (index >= 0) waiters.splice(index, 1)[0]?.resolve(frame);
    });
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        ws,
        frames,
        closed,
        send: (t, d) => ws.send(JSON.stringify({ v: PROTOCOL_VERSION, t, d })),
        waitFor: (t) => {
          const existing = frames.find((f) => f.t === t);
          if (existing) return Promise.resolve(existing);
          return new Promise((res) => waiters.push({ t, resolve: res }));
        },
      }),
    );
  });
}

describe('WebSocket transport', () => {
  it('authenticates, subscribes, and delivers a snapshot over a real socket', async () => {
    const token = await signUp('dm');
    const campaignId = (await rest('POST', '/api/campaigns', token, { name: 'Real' })).body.campaign
      .id as string;

    const client = await open();
    client.send('auth', { token });
    expect((await client.waitFor('auth.ok')).d.userId).toBeTruthy();
    client.send('resume', { campaignId });
    const snapshot = await client.waitFor('snapshot');
    expect(snapshot.d.members[0]).toMatchObject({ role: 'dm', online: true });
    client.ws.close();
  });

  it('relays chat between two real sockets', async () => {
    const dmToken = await signUp('dm');
    const playerToken = await signUp('player');
    const campaignId = (await rest('POST', '/api/campaigns', dmToken, { name: 'Chat' })).body
      .campaign.id as string;
    const { code } = (await rest('POST', `/api/campaigns/${campaignId}/invites`, dmToken, {})).body;
    await rest('POST', '/api/campaigns/join', playerToken, { code });

    const dm = await open();
    const player = await open();
    for (const [client, token] of [
      [dm, dmToken],
      [player, playerToken],
    ] as const) {
      client.send('auth', { token });
      await client.waitFor('auth.ok');
      client.send('resume', { campaignId });
      await client.waitFor('snapshot');
    }

    player.send('chat.message', { campaignId, text: 'hello table' });
    const received = await dm.waitFor('chat.message');
    expect(received).toMatchObject({
      seq: 1,
      d: { text: 'hello table', from: { name: 'player' } },
    });
    dm.ws.close();
    player.ws.close();
  });

  it('closes a socket when its session is revoked over REST', async () => {
    const token = await signUp('dm');
    const client = await open();
    client.send('auth', { token });
    await client.waitFor('auth.ok');

    expect((await rest('POST', '/api/auth/logout', token)).status).toBe(204);
    expect((await client.closed).code).toBe(4401);
    expect(client.frames.some((f) => f.t === 'auth.revoked')).toBe(true);
  });

  it('drops a socket that never authenticates', async () => {
    // The hub's default is 5 s; this verifies the wiring cheaply by sending a pre-auth frame instead.
    const client = await open();
    client.send('resume', { campaignId: 'x' });
    expect((await client.closed).code).toBe(4401);
  });

  it('refuses upgrades on other paths', async () => {
    await expect(open('/not-ws')).rejects.toBeDefined();
  });

  it('closes a connection that sends an oversize frame', async () => {
    const client = await open();
    client.ws.send('x'.repeat(100 * 1024));
    expect((await client.closed).code).toBe(1009); // "message too big"
  });

  it('ignores binary frames instead of crashing', async () => {
    const token = await signUp('dm');
    const client = await open();
    client.ws.send(Buffer.from([1, 2, 3]));
    client.send('auth', { token });
    expect((await client.waitFor('auth.ok')).d.userId).toBeTruthy();
    client.ws.close();
  });
});
