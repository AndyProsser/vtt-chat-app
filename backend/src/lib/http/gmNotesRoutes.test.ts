/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON bodies */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { BackendConfig } from '../config.js';
import { HandoutMediaSweeper } from '../media/handoutMediaSweeper.js';
import { MemoryMediaStorage } from '../media/mediaStorage.js';
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
  gmNotesMaxBytes: 1024,
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
let dm: { id: string; token: string };
let alice: { id: string; token: string };
let outsider: { id: string; token: string };
let campaign: string;
let other: string;

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

const gm = (c = campaign) => `/api/campaigns/${c}/gm`;
const attach = (token: string, name = 'map.png', file = PNG, c = campaign) =>
  call('POST', `${gm(c)}/notes/files?name=${encodeURIComponent(name)}`, token, undefined, file);

beforeEach(async () => {
  const store = await backend.reset();
  table =
    backend.kind === 'postgres' && backend.pool
      ? new PostgresTableStore(backend.pool)
      : new MemoryTableStore();
  media = new MemoryMediaStorage();
  const app = createApp({
    config: CONFIG,
    store,
    table,
    media,
    realtime: {
      revokeSession() {},
      announceRosterChanged() {},
      announceRecording() {},
    },
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dm = await person('dm');
  alice = await person('alice');
  outsider = await person('outsider');
  campaign = (await call('POST', '/api/campaigns', dm.token, { name: 'A' })).body.campaign.id;
  other = (await call('POST', '/api/campaigns', dm.token, { name: 'B' })).body.campaign.id;
  const { code } = (await call('POST', `/api/campaigns/${campaign}/invites`, dm.token, {})).body;
  await call('POST', '/api/campaigns/join', alice.token, { code });
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GM notes: the Game Master’s alone (protocol 4)', () => {
  it('starts empty, saves Markdown, and reads it back', async () => {
    const empty = (await call('GET', `${gm()}/notes`, dm.token)).body;
    expect(empty).toMatchObject({ body: '', updatedAt: null, files: [], maxFileBytes: 1024 });
    const saved = await call('PUT', `${gm()}/notes`, dm.token, { body: '# Secrets\r\nthe duke' });
    expect(saved.status).toBe(200);
    const read = (await call('GET', `${gm()}/notes`, dm.token)).body;
    expect(read.body).toBe('# Secrets\nthe duke');
    expect(read.updatedAt).toEqual(saved.body.updatedAt);
  });

  it('takes a page far larger than the usual JSON limit', async () => {
    const big = 'a line of notes\n'.repeat(60_000); // ~1 MB
    expect((await call('PUT', `${gm()}/notes`, dm.token, { body: big })).status).toBe(200);
    expect((await call('GET', `${gm()}/notes`, dm.token)).body.body).toHaveLength(big.length);
  });

  it('refuses a player, an outsider, and nobody signed in, on every route', async () => {
    const file = (await attach(dm.token)).body.file.id;
    const term = (await call('POST', `${gm()}/glossary`, dm.token, { term: 'Gary' })).body.term.id;
    const routes: [string, string, unknown?][] = [
      ['GET', `${gm()}/notes`],
      ['PUT', `${gm()}/notes`, { body: 'x' }],
      ['GET', `${gm()}/notes/files/${file}`],
      ['DELETE', `${gm()}/notes/files/${file}`],
      ['GET', `${gm()}/glossary`],
      ['POST', `${gm()}/glossary`, { term: 'x' }],
      ['PATCH', `${gm()}/glossary/${term}`, { term: 'y' }],
      ['POST', `${gm()}/glossary/${term}/approve`],
      ['DELETE', `${gm()}/glossary/${term}`],
    ];
    for (const [method, path, body] of routes) {
      expect((await call(method, path, alice.token, body)).status, `player ${method} ${path}`).toBe(
        403,
      );
      expect(
        (await call(method, path, outsider.token, body)).status,
        `outsider ${method} ${path}`,
      ).toBe(403);
      expect((await call(method, path, undefined, body)).status, `anon ${method} ${path}`).toBe(
        401,
      );
    }
    expect((await attach(alice.token)).status).toBe(403);
  });

  it('attaches pictures and PDFs, serves them inert, and removes them', async () => {
    const png = (await attach(dm.token, 'Map of the keep.png')).body.file;
    const pdf = (await attach(dm.token, 'rules.pdf', PDF)).body.file;
    expect(png).toMatchObject({ name: 'Map of the keep.png', kind: 'image', mime: 'image/png' });
    expect(pdf).toMatchObject({ kind: 'pdf', mime: 'application/pdf' });
    expect(
      (await call('GET', `${gm()}/notes`, dm.token)).body.files.map((f: any) => f.name),
    ).toEqual(['Map of the keep.png', 'rules.pdf']);
    const served = await call('GET', `${gm()}/notes/files/${png.id}`, dm.token);
    expect(served.bytes.equals(PNG)).toBe(true);
    expect(served.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await call('DELETE', `${gm()}/notes/files/${png.id}`, dm.token)).status).toBe(204);
    expect((await call('GET', `${gm()}/notes/files/${png.id}`, dm.token)).status).toBe(404);
    expect((await call('GET', `${gm()}/notes`, dm.token)).body.files).toHaveLength(1);
  });

  it('judges a file by its bytes and the operator’s ceiling, not its name', async () => {
    expect((await attach(dm.token, 'photo.png', Buffer.from('not an image'))).status).toBe(415);
    expect((await attach(dm.token, 'x.png', Buffer.alloc(0))).status).toBe(400);
    expect(
      (await attach(dm.token, 'huge.png', Buffer.concat([PNG, Buffer.alloc(2000)]))).status,
    ).toBe(413);
  });

  it('a file is reachable only through its own campaign', async () => {
    const id = (await attach(dm.token)).body.file.id;
    expect((await call('GET', `${gm(other)}/notes/files/${id}`, dm.token)).status).toBe(404);
    expect((await call('DELETE', `${gm(other)}/notes/files/${id}`, dm.token)).status).toBe(404);
  });

  it('keeps attachments from the media sweeper, and a deleted campaign’s files are swept', async () => {
    await attach(dm.token);
    expect(media.files.size).toBe(1);
    expect(await new HandoutMediaSweeper(table, media).sweep(0)).toBe(0);
    expect(media.files.size).toBe(1);
    // removing the file takes its bytes with it
    const id = (await call('GET', `${gm()}/notes`, dm.token)).body.files[0].id;
    await call('DELETE', `${gm()}/notes/files/${id}`, dm.token);
    expect(media.files.size).toBe(0);
  });
});

describe('the glossary (protocol 4)', () => {
  const add = (body: unknown, token = dm.token) => call('POST', `${gm()}/glossary`, token, body);

  it('adds, lists by term, edits and removes terms with aliases', async () => {
    const gary = (
      await add({
        term: '  Gary   the Grumpy Gnome ',
        kind: 'person',
        aliases: ['Gary', 'gary', ' the gnome '],
      })
    ).body.term;
    expect(gary).toMatchObject({
      term: 'Gary the Grumpy Gnome',
      kind: 'person',
      aliases: ['Gary', 'the gnome'],
      status: 'approved',
    });
    await add({ term: 'Absalom', kind: 'place' });
    expect(
      (await call('GET', `${gm()}/glossary`, dm.token)).body.terms.map((t: any) => t.term),
    ).toEqual(['Absalom', 'Gary the Grumpy Gnome']);
    const edited = await call('PATCH', `${gm()}/glossary/${gary.id}`, dm.token, { aliases: ['G'] });
    expect(edited.body.term).toMatchObject({ term: 'Gary the Grumpy Gnome', aliases: ['G'] });
    expect((await call('DELETE', `${gm()}/glossary/${gary.id}`, dm.token)).status).toBe(204);
    expect((await call('GET', `${gm()}/glossary`, dm.token)).body.terms).toHaveLength(1);
  });

  it('refuses a repeated spelling, a bad kind and an empty term', async () => {
    await add({ term: 'Absalom' });
    expect((await add({ term: 'ABSALOM' })).status).toBe(409);
    expect((await add({ term: 'X', kind: 'planet' })).status).toBe(400);
    expect((await add({ term: '   ' })).status).toBe(400);
    expect((await add({ term: 'x'.repeat(101) })).status).toBe(400);
    expect(
      (await add({ term: 'Many', aliases: Array.from({ length: 11 }, (_, i) => `a${i}`) })).status,
    ).toBe(400);
  });

  it('keeps a campaign’s terms to that campaign, and approves a suggestion', async () => {
    const id = (await add({ term: 'Absalom' })).body.term.id;
    expect(
      (await call('PATCH', `${gm(other)}/glossary/${id}`, dm.token, { term: 'Hijack' })).status,
    ).toBe(404);
    expect((await call('GET', `${gm(other)}/glossary`, dm.token)).body.terms).toEqual([]);
    // a suggestion (as the AI work will leave one) waits until the Game Master approves it
    await table.putGlossaryTerm({
      id: '00000000-0000-4000-8000-000000000001',
      campaignId: campaign,
      term: 'Zalthor',
      kind: 'person',
      aliases: [],
      status: 'suggested',
      createdAt: 1,
    });
    const listed = (await call('GET', `${gm()}/glossary`, dm.token)).body.terms;
    expect(listed.find((t: any) => t.term === 'Zalthor').status).toBe('suggested');
    const approved = await call(
      'POST',
      `${gm()}/glossary/00000000-0000-4000-8000-000000000001/approve`,
      dm.token,
    );
    expect(approved.body.term.status).toBe('approved');
  });
});
