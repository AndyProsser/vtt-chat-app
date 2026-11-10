/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON bodies */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_CAMPAIGN_HANDOUT_BYTES, MAX_HANDOUT_BYTES } from '../../consts/index.js';
import { createApp } from '../app.js';
import type { BackendConfig } from '../config.js';
import { DiskMediaStorage, MemoryMediaStorage, detectMedia } from '../media/mediaStorage.js';
import { openTestBackend } from '../store/testing.js';
import { MemoryTableStore } from '../table/memoryTableStore.js';
import { PostgresTableStore } from '../table/postgresTableStore.js';
import type { TableStore } from '../table/tableStore.js';

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

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const PDF = Buffer.from('%PDF-1.7\n%…\n');

let server: Server;
let base: string;
let table: TableStore;
let media: MemoryMediaStorage;
let shown: any[];
let removed: any[];
let dm: { id: string; token: string };
let alice: { id: string; token: string };
let bob: { id: string; token: string };
let outsider: { id: string; token: string };
let campaign: string;
let other: string;

async function call(method: string, path: string, token?: string, body?: unknown, raw?: Buffer) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(raw ? { 'Content-Type': 'image/png' } : {}),
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

const upload = (token: string, c = campaign, q = 'title=Map&kind=map&name=m.png', file = PNG) =>
  call('POST', `/api/campaigns/${c}/handouts/upload?${q}`, token, undefined, file);

beforeEach(async () => {
  const store = await backend.reset();
  table =
    backend.kind === 'postgres' && backend.pool
      ? new PostgresTableStore(backend.pool)
      : new MemoryTableStore();
  media = new MemoryMediaStorage();
  shown = [];
  removed = [];
  const app = createApp({
    config: CONFIG,
    store,
    table,
    media,
    realtime: {
      revokeSession() {},
      announceRosterChanged() {},
      announceRecording() {},
      announceHandoutShown: (c, h, a, dmIds) => shown.push({ c, id: h.id, a, dmIds }),
      announceHandoutRemoved: (c, id) => removed.push({ c, id }),
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

describe('drafts and showing', () => {
  it('a new handout is a DM-only draft: players can neither list it, open it nor fetch its file', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    expect(
      (await call('GET', `/api/campaigns/${campaign}/handouts`, alice.token)).body.handouts,
    ).toEqual([]);
    expect(
      (await call('GET', `/api/campaigns/${campaign}/handouts/${id}`, alice.token)).status,
    ).toBe(404);
    expect(
      (await call('GET', `/api/campaigns/${campaign}/handouts/${id}/file`, alice.token)).status,
    ).toBe(404);
    expect(
      (await call('GET', `/api/campaigns/${campaign}/handouts`, dm.token)).body.handouts,
    ).toHaveLength(1);
  });

  it('showing to everyone lets every member list and download it, with inert headers', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    expect(
      (
        await call('POST', `/api/campaigns/${campaign}/handouts/${id}/show`, dm.token, {
          to: 'all',
        })
      ).status,
    ).toBe(200);
    for (const p of [alice, bob]) {
      const file = await call('GET', `/api/campaigns/${campaign}/handouts/${id}/file`, p.token);
      expect(file.status).toBe(200);
      expect(file.headers.get('content-type')).toBe('image/png');
      expect(file.headers.get('x-content-type-options')).toBe('nosniff');
      expect(file.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(file.bytes.equals(PNG)).toBe(true);
    }
    expect(shown).toEqual([
      { c: campaign, id, a: { everyone: true, userIds: [] }, dmIds: [dm.id] },
    ]);
  });

  it('showing to chosen players reaches only them (and the DM), live and by API', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    await call('POST', `/api/campaigns/${campaign}/handouts/${id}/show`, dm.token, {
      to: [bob.id],
    });
    expect((await call('GET', `/api/campaigns/${campaign}/handouts/${id}`, bob.token)).status).toBe(
      200,
    );
    expect(
      (await call('GET', `/api/campaigns/${campaign}/handouts/${id}`, alice.token)).status,
    ).toBe(404);
    expect(shown[0].a).toEqual({ everyone: false, userIds: [bob.id] });
  });

  it('hiding takes it back to a draft and tells clients to drop it', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    await call('POST', `/api/campaigns/${campaign}/handouts/${id}/show`, dm.token, { to: 'all' });
    await call('POST', `/api/campaigns/${campaign}/handouts/${id}/hide`, dm.token, {});
    expect(
      (await call('GET', `/api/campaigns/${campaign}/handouts/${id}`, alice.token)).status,
    ).toBe(404);
    expect(removed).toEqual([{ c: campaign, id }]);
  });

  it('refuses to show a handout to someone who is not in the campaign', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    const r = await call('POST', `/api/campaigns/${campaign}/handouts/${id}/show`, dm.token, {
      to: [outsider.id],
    });
    expect(r.status).toBe(400);
  });

  it('text snippets work without file storage and are shown like any handout', async () => {
    const made = await call('POST', `/api/campaigns/${campaign}/handouts`, dm.token, {
      title: 'Riddle',
      text: 'Speak friend and enter.',
    });
    expect(made.status).toBe(201);
    const id = made.body.handout.id;
    expect(made.body.handout).toMatchObject({ kind: 'text', hasFile: false, visibility: 'dm' });
    await call('POST', `/api/campaigns/${campaign}/handouts/${id}/show`, dm.token, { to: 'all' });
    expect(
      (await call('GET', `/api/campaigns/${campaign}/handouts/${id}`, alice.token)).body.handout
        .body,
    ).toBe('Speak friend and enter.');
  });
});

const PNG2 = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 9),
]);

describe('a set of pictures', () => {
  const addImage = (token: string, id: string, file = PNG2, c = campaign) =>
    call('POST', `/api/campaigns/${c}/handouts/${id}/images?name=b.png`, token, undefined, file);

  it('grows by one picture at a time, in order, and each one can be fetched', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    expect((await addImage(dm.token, id)).body.handout.fileCount).toBe(2);
    const list = (await call('GET', `/api/campaigns/${campaign}/handouts`, dm.token)).body.handouts;
    expect(list[0]).toMatchObject({ id, fileCount: 2, hasFile: true });
    const first = await call('GET', `/api/campaigns/${campaign}/handouts/${id}/files/0`, dm.token);
    const second = await call('GET', `/api/campaigns/${campaign}/handouts/${id}/files/1`, dm.token);
    expect(first.bytes.equals(PNG)).toBe(true);
    expect(second.bytes.equals(PNG2)).toBe(true);
    expect(
      (await call('GET', `/api/campaigns/${campaign}/handouts/${id}/file`, dm.token)).bytes.equals(
        PNG,
      ),
    ).toBe(true);
    expect(
      (await call('GET', `/api/campaigns/${campaign}/handouts/${id}/files/2`, dm.token)).status,
    ).toBe(404);
  });

  it('is limited to twelve pictures, and only the DM can add them', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    expect((await addImage(alice.token, id)).status).toBe(403);
    for (let i = 1; i < 12; i++) expect((await addImage(dm.token, id)).status).toBe(200);
    expect((await addImage(dm.token, id)).status).toBe(400);
  });

  it('never mixes: a PDF takes no pictures and a picture set takes no PDF', async () => {
    const pdf = (await upload(dm.token, campaign, 'title=Doc&kind=pdf&name=d.pdf', PDF)).body
      .handout.id;
    expect((await addImage(dm.token, pdf)).status).toBe(400);
    const set = (await upload(dm.token)).body.handout.id;
    expect((await addImage(dm.token, set, PDF)).status).toBe(415);
  });

  it('removes every file when the handout is deleted', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    await addImage(dm.token, id);
    expect(media.files.size).toBe(2);
    await call('DELETE', `/api/campaigns/${campaign}/handouts/${id}`, dm.token);
    expect(media.files.size).toBe(0);
  });

  it('counts every picture against the campaign storage', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    await addImage(dm.token, id);
    expect(await table.campaignHandoutBytes(campaign)).toBe(PNG.length + PNG2.length);
  });

  it('lets the DM remove a picture (never the last) and the rest close up in order', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    await addImage(dm.token, id, PNG2);
    const path = (n: number) => `/api/campaigns/${campaign}/handouts/${id}/files/${n}`;
    expect((await call('DELETE', path(0), alice.token)).status).toBe(403);
    expect((await call('DELETE', path(0), dm.token)).body.handout.fileCount).toBe(1);
    expect((await call('GET', path(0), dm.token)).bytes.equals(PNG2)).toBe(true);
    expect(media.files.size).toBe(1); // the removed picture's bytes are gone too
    expect((await call('DELETE', path(0), dm.token)).status).toBe(400); // the last one stays
    expect((await call('DELETE', path(5), dm.token)).status).toBe(404);
  });

  it('lets the DM put the pictures in a new order, and refuses an order that is not a shuffle', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    await addImage(dm.token, id, PNG2);
    const order = (body: unknown, token = dm.token) =>
      call('PUT', `/api/campaigns/${campaign}/handouts/${id}/files`, token, body);
    expect((await order({ order: [1, 0] })).body.handout.fileCount).toBe(2);
    const first = await call('GET', `/api/campaigns/${campaign}/handouts/${id}/files/0`, dm.token);
    expect(first.bytes.equals(PNG2)).toBe(true);
    expect((await order({ order: [0, 0] })).status).toBe(400);
    expect((await order({ order: [0] })).status).toBe(400);
    expect((await order({ order: [0, 2] })).status).toBe(400);
    expect((await order({ order: [0, 1] }, alice.token)).status).toBe(403);
  });

  it('lets the DM give a picture or PDF handout a caption, and clear it', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    const set = await call('PATCH', `/api/campaigns/${campaign}/handouts/${id}`, dm.token, {
      text: 'The ward on the north wall.',
    });
    expect(set.body.handout.body).toBe('The ward on the north wall.');
    const cleared = await call('PATCH', `/api/campaigns/${campaign}/handouts/${id}`, dm.token, {
      text: '',
    });
    expect(cleared.body.handout.body).toBeNull();
  });
});

describe('editing a handout', () => {
  it('lets the DM change the title and text, and players see the new version', async () => {
    const id = (
      await call('POST', `/api/campaigns/${campaign}/handouts`, dm.token, {
        title: 'Riddle',
        text: 'Speak friend.',
      })
    ).body.handout.id;
    await call('POST', `/api/campaigns/${campaign}/handouts/${id}/show`, dm.token, { to: 'all' });
    const edited = await call('PATCH', `/api/campaigns/${campaign}/handouts/${id}`, dm.token, {
      title: 'The riddle',
      text: 'Speak friend and enter.',
    });
    expect(edited.status).toBe(200);
    const seen = (await call('GET', `/api/campaigns/${campaign}/handouts/${id}`, alice.token)).body
      .handout;
    expect(seen).toMatchObject({ title: 'The riddle', body: 'Speak friend and enter.' });
    expect(seen.visibility).toBe('all');
  });

  it('refuses players, empty titles, and text on a picture', async () => {
    const text = (
      await call('POST', `/api/campaigns/${campaign}/handouts`, dm.token, {
        title: 'Riddle',
        text: 'Speak friend.',
      })
    ).body.handout.id;
    const patch = (id: string, token: string, body: object) =>
      call('PATCH', `/api/campaigns/${campaign}/handouts/${id}`, token, body);
    expect((await patch(text, alice.token, { title: 'x' })).status).toBe(403);
    expect((await patch(text, dm.token, { title: '   ' })).status).toBe(400);
    const picture = (await upload(dm.token)).body.handout.id;
    expect((await patch(picture, dm.token, { title: 'A better name' })).status).toBe(200);
  });
});

describe('who may do what', () => {
  it('only the DM creates, shows, hides and deletes', async () => {
    expect((await upload(alice.token)).status).toBe(403);
    expect(
      (
        await call('POST', `/api/campaigns/${campaign}/handouts`, alice.token, {
          title: 'x',
          text: 'y',
        })
      ).status,
    ).toBe(403);
    const id = (await upload(dm.token)).body.handout.id;
    await call('POST', `/api/campaigns/${campaign}/handouts/${id}/show`, dm.token, { to: 'all' });
    for (const action of ['show', 'hide']) {
      expect(
        (
          await call('POST', `/api/campaigns/${campaign}/handouts/${id}/${action}`, alice.token, {
            to: 'all',
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (await call('DELETE', `/api/campaigns/${campaign}/handouts/${id}`, alice.token)).status,
    ).toBe(403);
  });

  it('is closed to non-members and to the unauthenticated', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    await call('POST', `/api/campaigns/${campaign}/handouts/${id}/show`, dm.token, { to: 'all' });
    expect((await call('GET', `/api/campaigns/${campaign}/handouts`, outsider.token)).status).toBe(
      403,
    );
    expect(
      (await call('GET', `/api/campaigns/${campaign}/handouts/${id}/file`, outsider.token)).status,
    ).toBe(403);
    expect((await call('GET', `/api/campaigns/${campaign}/handouts`)).status).toBe(401);
  });

  it('a handout is reachable only through its own campaign', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    expect((await call('GET', `/api/campaigns/${other}/handouts/${id}`, dm.token)).status).toBe(
      404,
    );
    expect(
      (await call('GET', `/api/campaigns/${other}/handouts/${id}/file`, dm.token)).status,
    ).toBe(404);
    expect(
      (await call('GET', `/api/campaigns/${campaign}/handouts/not-a-uuid`, dm.token)).status,
    ).toBe(404);
  });
});

describe('uploads are checked by their bytes', () => {
  it('rejects HTML and SVG dressed up as images, and a PDF sent as an image', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect((await upload(dm.token, campaign, 'title=x&kind=image', html)).status).toBe(415);
    expect((await upload(dm.token, campaign, 'title=x&kind=image', svg)).status).toBe(415);
    expect((await upload(dm.token, campaign, 'title=x&kind=image', PDF)).status).toBe(415);
    expect((await upload(dm.token, campaign, 'title=x&kind=pdf', PNG)).status).toBe(415);
    expect(media.files.size).toBe(0);
  });

  it('accepts a PDF as a pdf, and requires a title and a valid kind', async () => {
    expect((await upload(dm.token, campaign, 'title=Lore&kind=pdf', PDF)).status).toBe(201);
    expect((await upload(dm.token, campaign, 'kind=pdf', PDF)).status).toBe(400);
    expect((await upload(dm.token, campaign, 'title=x&kind=exe', PDF)).status).toBe(400);
  });

  it('rejects an empty file and one over the size limit', async () => {
    expect((await upload(dm.token, campaign, 'title=x&kind=image', Buffer.alloc(0))).status).toBe(
      400,
    );
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_HANDOUT_BYTES)]);
    expect((await upload(dm.token, campaign, 'title=x&kind=image', big)).status).toBe(413);
  });

  it('stops a campaign that has used up its file quota', async () => {
    const f = backend.newId();
    await table.putMedia({
      id: f,
      ownerId: dm.id,
      kind: 'image',
      mime: 'image/png',
      bytes: MAX_CAMPAIGN_HANDOUT_BYTES,
      sha256: 'x',
      originalName: 'big',
      createdAt: 1,
    });
    await table.putHandout({
      id: backend.newId(),
      campaignId: campaign,
      title: 'big',
      kind: 'image',
      body: null,
      mediaIds: [f],
      visibility: 'dm',
      recipients: [],
      createdBy: dm.id,
      createdAt: 1,
    });
    expect((await upload(dm.token)).status).toBe(413);
    expect((await upload(dm.token, other)).status).toBe(201); // another campaign is unaffected
  });
});

describe('deleting', () => {
  it('removes the handout, its metadata and the file bytes', async () => {
    const id = (await upload(dm.token)).body.handout.id;
    expect(media.files.size).toBe(1);
    expect(
      (await call('DELETE', `/api/campaigns/${campaign}/handouts/${id}`, dm.token)).status,
    ).toBe(204);
    expect(media.files.size).toBe(0);
    expect(
      (await call('GET', `/api/campaigns/${campaign}/handouts`, dm.token)).body.handouts,
    ).toEqual([]);
    expect(removed).toEqual([{ c: campaign, id }]);
  });
});

describe('media helpers', () => {
  it('recognises the supported formats from their first bytes only', () => {
    expect(detectMedia(PNG)?.mime).toBe('image/png');
    expect(detectMedia(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(detectMedia(Buffer.from('GIF89a....'))?.mime).toBe('image/gif');
    expect(detectMedia(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))?.mime).toBe('image/webp');
    expect(detectMedia(PDF)?.mime).toBe('application/pdf');
    expect(detectMedia(Buffer.from('OggS\0'))?.kind).toBe('audio');
    expect(detectMedia(Buffer.from('#!/bin/sh\necho hi'))).toBeUndefined();
    expect(detectMedia(Buffer.alloc(0))).toBeUndefined();
  });

  it('disk storage refuses an id that could escape its directory', async () => {
    const disk = new DiskMediaStorage('/tmp/never-written');
    for (const id of ['../etc/passwd', 'a/b', '..', '']) {
      await expect(disk.put(id, Buffer.from('x'))).rejects.toThrow(/invalid media id/);
      await expect(disk.get(id)).rejects.toThrow(/invalid media id/);
    }
  });
});
