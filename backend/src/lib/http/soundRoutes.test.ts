/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON bodies */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_SOUND_BYTES } from '../../consts/index.js';
import { createApp } from '../app.js';
import type { BackendConfig } from '../config.js';
import { MemoryMediaStorage } from '../media/mediaStorage.js';
import { MemorySoundStore } from '../soundboard/memorySoundStore.js';
import { PostgresSoundStore } from '../soundboard/postgresSoundStore.js';
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

const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(60, 3)]);
const WAV = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WAVEfmt '),
  Buffer.alloc(40),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(40),
]);

let server: Server;
let base: string;
let media: MemoryMediaStorage;
let dm: { id: string; token: string };
let dm2: { id: string; token: string };
let alice: { id: string; token: string };
let outsider: { id: string; token: string };
let campaign: string;
let campaign2: string;

async function call(method: string, path: string, token?: string, body?: unknown, raw?: Buffer) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(raw
      ? { body: new Uint8Array(raw) }
      : body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
  });
  const type = response.headers.get('content-type') ?? '';
  const buf = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    headers: response.headers,
    bytes: buf,
    body: type.includes('json') && buf.length ? JSON.parse(buf.toString()) : undefined,
  };
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
const upload = (token: string, q = 'name=Door&category=effect&tags=Wood,creak', file = OGG) =>
  call('POST', `/api/soundboard/sounds/upload?${q}`, token, undefined, file);

beforeEach(async () => {
  const store = await backend.reset();
  const pg = backend.kind === 'postgres' && backend.pool;
  const table = pg ? new PostgresTableStore(backend.pool!) : new MemoryTableStore();
  const sounds = pg ? new PostgresSoundStore(backend.pool!) : new MemorySoundStore();
  media = new MemoryMediaStorage();
  const app = createApp({ config: CONFIG, store, table, sounds, media });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dm = await person('dm');
  dm2 = await person('dmtwo');
  alice = await person('alice');
  outsider = await person('outsider');
  campaign = (await call('POST', '/api/campaigns', dm.token, { name: 'A' })).body.campaign.id;
  const { code } = (await call('POST', `/api/campaigns/${campaign}/invites`, dm.token, {})).body;
  await call('POST', '/api/campaigns/join', alice.token, { code });
  // a second table run by a different DM, where alice is not a member
  await call('POST', '/api/auth/consent', dm2.token, { version: '1' });
  campaign2 = (await call('POST', '/api/campaigns', dm.token, { name: 'B' })).body.campaign.id;
  void campaign2;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('the library is the DM’s own', () => {
  it('uploads a clip as a sound with one take, normalising tags', async () => {
    const r = await upload(dm.token);
    expect(r.status).toBe(201);
    expect(r.body.sound).toMatchObject({
      name: 'Door',
      category: 'effect',
      tags: ['wood', 'creak'],
    });
    expect(r.body.sound.takes).toHaveLength(1);
    expect(media.files.size).toBe(1);
    expect((await call('GET', '/api/soundboard/library', dm.token)).body.sounds).toHaveLength(1);
  });

  it('nobody else sees or touches it', async () => {
    const id = (await upload(dm.token)).body.sound.id;
    expect((await call('GET', '/api/soundboard/library', dm2.token)).body.sounds).toEqual([]);
    expect(
      (await call('PATCH', `/api/soundboard/sounds/${id}`, dm2.token, { name: 'mine now' })).status,
    ).toBe(404);
    expect((await call('DELETE', `/api/soundboard/sounds/${id}`, dm2.token)).status).toBe(404);
    expect((await call('GET', '/api/soundboard/library')).status).toBe(401);
  });

  it('adds takes, trims their loudness, and refuses to remove the last one', async () => {
    const s = (await upload(dm.token)).body.sound;
    const added = await call(
      'POST',
      `/api/soundboard/sounds/${s.id}/takes?level=0.5`,
      dm.token,
      undefined,
      WAV,
    );
    expect(added.status).toBe(201);
    expect(added.body.sound.takes.map((t: any) => t.level)).toEqual([1, 0.5]);
    const removed = await call(
      'DELETE',
      `/api/soundboard/sounds/${s.id}/takes/${added.body.sound.takes[1].id}`,
      dm.token,
    );
    expect(removed.status).toBe(200);
    expect(media.files.size).toBe(1);
    const last = await call(
      'DELETE',
      `/api/soundboard/sounds/${s.id}/takes/${removed.body.sound.takes[0].id}`,
      dm.token,
    );
    expect(last.status).toBe(409);
  });

  it('only accepts audio, judged by its bytes, within the size limit', async () => {
    expect((await upload(dm.token, 'name=x&category=effect', PNG)).status).toBe(415);
    expect((await upload(dm.token, 'name=x&category=effect', Buffer.from('<html>'))).status).toBe(
      415,
    );
    expect((await upload(dm.token, 'name=x&category=effect', Buffer.alloc(0))).status).toBe(400);
    expect(
      (
        await upload(
          dm.token,
          'name=x&category=effect',
          Buffer.concat([OGG, Buffer.alloc(MAX_SOUND_BYTES)]),
        )
      ).status,
    ).toBe(413);
    expect((await upload(dm.token, 'category=effect')).status).toBe(400);
    expect((await upload(dm.token, 'name=x&category=noise')).status).toBe(400);
    expect(media.files.size).toBe(0);
  });

  it('deleting a sound removes its clips and scrubs it from boards and scenes', async () => {
    const door = (await upload(dm.token)).body.sound;
    const rain = (await upload(dm.token, 'name=Rain&category=ambience')).body.sound;
    const board = (
      await call('POST', '/api/soundboard/boards', dm.token, {
        name: 'Dungeon',
        buttons: [
          { label: 'Door', soundId: door.id },
          { label: 'Rain', soundId: rain.id, mode: 'loop' },
        ],
      })
    ).body.board;
    const scene = (
      await call('POST', '/api/soundboard/scenes', dm.token, {
        name: 'Storm',
        layers: [{ soundId: door.id }, { soundId: rain.id }],
      })
    ).body.scene;
    expect((await call('DELETE', `/api/soundboard/sounds/${door.id}`, dm.token)).status).toBe(204);
    expect(media.files.size).toBe(1);
    const lib = (await call('GET', '/api/soundboard/library', dm.token)).body;
    expect(lib.boards.find((b: any) => b.id === board.id).buttons.map((b: any) => b.label)).toEqual(
      ['Rain'],
    );
    expect(lib.scenes.find((s: any) => s.id === scene.id).layers).toHaveLength(1);
  });
});

describe('boards and scenes', () => {
  it('only use sounds from your own library', async () => {
    const theirs = (await upload(dm2.token)).body.sound.id;
    const r = await call('POST', '/api/soundboard/boards', dm.token, {
      name: 'x',
      buttons: [{ label: 'b', soundId: theirs }],
    });
    expect(r.status).toBe(400);
    expect(
      (
        await call('POST', '/api/soundboard/scenes', dm.token, {
          name: 'x',
          layers: [{ soundId: theirs }],
        })
      ).status,
    ).toBe(400);
  });

  it('enforce the size limits and sane random intervals', async () => {
    const s = (await upload(dm.token)).body.sound.id;
    const many = (n: number) => Array.from({ length: n }, () => ({ soundId: s }));
    expect(
      (await call('POST', '/api/soundboard/scenes', dm.token, { name: 'twelve', layers: many(12) }))
        .status,
    ).toBe(201);
    expect(
      (
        await call('POST', '/api/soundboard/scenes', dm.token, {
          name: 'thirteen',
          layers: many(13),
        })
      ).status,
    ).toBe(400);
    const bad = {
      name: 'r',
      layers: [{ soundId: s, mode: 'random', minIntervalSec: 30, maxIntervalSec: 10 }],
    };
    expect((await call('POST', '/api/soundboard/scenes', dm.token, bad)).status).toBe(400);
    const good = {
      name: 'r',
      layers: [{ soundId: s, mode: 'random', minIntervalSec: 5, maxIntervalSec: 15 }],
    };
    expect((await call('POST', '/api/soundboard/scenes', dm.token, good)).status).toBe(201);
  });

  it('can be edited and deleted by their owner only', async () => {
    const s = (await upload(dm.token)).body.sound.id;
    const board = (
      await call('POST', '/api/soundboard/boards', dm.token, {
        name: 'A',
        buttons: [{ label: 'x', soundId: s }],
      })
    ).body.board;
    const edited = await call('PUT', `/api/soundboard/boards/${board.id}`, dm.token, {
      name: 'B',
      buttons: [],
    });
    expect(edited.body.board).toMatchObject({ id: board.id, name: 'B', buttons: [] });
    expect(
      (
        await call('PUT', `/api/soundboard/boards/${board.id}`, dm2.token, {
          name: 'hijack',
          buttons: [],
        })
      ).status,
    ).toBe(404);
    expect((await call('DELETE', `/api/soundboard/boards/${board.id}`, dm2.token)).status).toBe(
      404,
    );
    expect((await call('DELETE', `/api/soundboard/boards/${board.id}`, dm.token)).status).toBe(204);
  });
});

describe('players fetching a clip', () => {
  const clip = (c: string, take: string, token: string) =>
    call('GET', `/api/campaigns/${c}/sounds/takes/${take}/file`, token);

  it('a member of the DM’s campaign can fetch it, with inert headers', async () => {
    const take = (await upload(dm.token)).body.sound.takes[0].id;
    const r = await clip(campaign, take, alice.token);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/ogg');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.bytes.equals(OGG)).toBe(true);
  });

  it('a non-member, and a campaign whose DM is someone else, get nothing', async () => {
    const take = (await upload(dm.token)).body.sound.takes[0].id;
    expect((await clip(campaign, take, outsider.token)).status).toBe(403);
    // dm2 is not the DM of `campaign`: their own clip cannot be served through it.
    const theirs = (await upload(dm2.token)).body.sound.takes[0].id;
    expect((await clip(campaign, theirs, alice.token)).status).toBe(404);
    expect((await clip(campaign, 'not-a-uuid', alice.token)).status).toBe(404);
    expect((await call('GET', `/api/campaigns/${campaign}/sounds/takes/${take}/file`)).status).toBe(
      401,
    );
  });
});
