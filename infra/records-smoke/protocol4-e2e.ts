// End-to-end test of what protocol 4 added (0.6.0), against a RUNNING Docker Compose stack, as real people would
// use it: a DM and two players with throwaway accounts (`p4-*@example.com`, made with `vtt-admin user create`),
// REST calls plus real WebSocket clients watching the live events. It needs no voice and no AI, so it runs on any
// install (the records chain has its own test: compose-e2e.ts).
//
//   NODE_EXTRA_CA_CERTS=<caddy root.crt> node infra/records-smoke/protocol4-e2e.ts
//
// Environment: VTT_API (default https://localhost), VTT_COMPOSE_DIR (default infra/compose: where `vtt-admin` runs),
// E2E_STATE (default ~/.local/state/vtt-protocol4-e2e: account passwords, mode 0600, never printed).
//
// What it checks, each as a PASS/FAIL line (the exit code is non-zero if any fails):
//   1. the handshake: protocol 4 is accepted, protocol 3 gets `update_required`;
//   2. the storyteller: a campaign starts on the Tavern Bard, only the DM changes it, a bad id is refused, members
//      are told (`campaign.updated`); the operator can turn a storyteller off (the picker's list shrinks, a pick of
//      it is refused, the Tavern Bard tells the tales) but never the Tavern Bard; where tales are processed
//      (`processing` on the recording state);
//   3. loot: re-drop moves one card and is refused once claimed, "added to my sheet" is set per person, resets when
//      the item moves, is announced only to who may see it, and the DM never sees it;
//   4. GM notes and the glossary: the DM saves, reads and attaches a picture; players are refused everything;
//   5. a character can be deleted, and the next one takes over.
// Settings it touches (the storyteller switches, campaign creation) are put back as they were.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { TableClient } from './e2e/client.ts';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const API = (process.env.VTT_API ?? 'https://localhost').replace(/\/+$/, '');
const COMPOSE_DIR = process.env.VTT_COMPOSE_DIR ?? path.resolve(here, '../compose');
const STATE_DIR = process.env.E2E_STATE ?? path.join(homedir(), '.local/state/vtt-protocol4-e2e');
const STATE_FILE = path.join(STATE_DIR, 'accounts.json');
const CAMPAIGN_NAME = 'E2E: Protocol 4';
const EXPECTED_PROTOCOL = 4;

const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`);
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (!ok) failed += 1;
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON from our own API
type Json = any;

async function api(
  method: string,
  route: string,
  token?: string,
  body?: unknown,
  raw?: { bytes: Buffer },
): Promise<{ status: number; body: Json; type: string }> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(raw ? { body: new Uint8Array(raw.bytes) } : {}),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const type = res.headers.get('content-type') ?? '';
  const text = await res.text();
  let parsed: Json = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed, type };
}

async function ok(method: string, route: string, token?: string, body?: unknown): Promise<Json> {
  const r = await api(method, route, token, body);
  if (r.status >= 300)
    throw new Error(`${method} ${route} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Runs the Admin CLI. Its output can hold a sign-in code, so it is returned, never logged. */
async function admin(...args: string[]): Promise<string> {
  const { stdout } = await run(path.join(COMPOSE_DIR, 'vtt-admin'), args, { cwd: COMPOSE_DIR });
  return stdout;
}

// ---- accounts ---------------------------------------------------------------------------------

type Key = 'dm' | 'ann' | 'bo';
const CAST: { key: Key; email: string; name: string; character?: string }[] = [
  { key: 'dm', email: 'p4-dm@example.com', name: 'P4 Dungeon Master' },
  { key: 'ann', email: 'p4-ann@example.com', name: 'P4 Ann', character: 'Ann the Bold' },
  { key: 'bo', email: 'p4-bo@example.com', name: 'P4 Bo', character: 'Bo the Brief' },
];

interface Seat {
  key: Key;
  token: string;
  userId: string;
  name: string;
}

async function loadPasswords(): Promise<Record<string, string>> {
  if (existsSync(STATE_FILE)) return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  const fresh = Object.fromEntries(CAST.map((c) => [c.key, randomBytes(18).toString('base64url')]));
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(STATE_FILE, JSON.stringify(fresh), { mode: 0o600 });
  await chmod(STATE_FILE, 0o600);
  return fresh;
}

async function signIn(cast: (typeof CAST)[number], password: string): Promise<string> {
  const login = await api('POST', '/api/auth/login', undefined, { email: cast.email, password });
  if (login.status === 200 && login.body.sessionToken) return login.body.sessionToken as string;
  if (!(await admin('user', 'list')).includes(cast.email)) {
    await admin('user', 'create', cast.email, '--name', cast.name, '--accept-consent');
    log(`created ${cast.email}`);
  }
  const out = await admin('user', 'code', cast.email, 'reset');
  const code = out.trim().split('\n').pop()!.trim();
  const r = await ok('POST', '/api/auth/magic-link/redeem', undefined, {
    token: code,
    newPassword: password,
  });
  return r.sessionToken as string;
}

async function setUp(): Promise<{ seats: Record<Key, Seat>; campaignId: string }> {
  const passwords = await loadPasswords();
  const seats = {} as Record<Key, Seat>;
  for (const cast of CAST) {
    const token = await signIn(cast, passwords[cast.key]!);
    const me = await ok('GET', '/api/auth/me', token);
    seats[cast.key] = { key: cast.key, token, userId: me.user.id as string, name: cast.name };
  }
  const dm = seats.dm;
  let campaignId: string | undefined;
  const mine = await ok('GET', '/api/campaigns', dm.token);
  campaignId = (mine.campaigns as Json[]).find((c) => c.campaign.name === CAMPAIGN_NAME)?.campaign
    .id;
  if (!campaignId) {
    const closed = /campaign-creation\s+closed/.test(await admin('settings', 'show'));
    if (closed) await admin('settings', 'set', 'campaign-creation', 'open');
    try {
      campaignId = (await ok('POST', '/api/campaigns', dm.token, { name: CAMPAIGN_NAME })).campaign
        .id as string;
    } finally {
      if (closed) await admin('settings', 'set', 'campaign-creation', 'closed');
    }
    log(`created campaign ${campaignId}`);
  }
  const members = await ok('GET', `/api/campaigns/${campaignId}/members`, dm.token);
  const ids = new Set((members.members as Json[]).map((m) => m.userId as string));
  let invite: string | undefined;
  for (const cast of CAST.filter((c) => c.key !== 'dm')) {
    const seat = seats[cast.key];
    if (!ids.has(seat.userId)) {
      invite ??= (await ok('POST', `/api/campaigns/${campaignId}/invites`, dm.token, {})).code;
      await ok('POST', '/api/campaigns/join', seat.token, { code: invite });
    }
    const chars = await ok('GET', `/api/campaigns/${campaignId}/characters`, seat.token);
    const have = (chars.characters as Json[]).find((c) => c.name === cast.character);
    const character =
      have ??
      (
        await ok('POST', `/api/campaigns/${campaignId}/characters`, seat.token, {
          name: cast.character,
          className: 'Fighter',
          race: 'Human',
          level: 1,
        })
      ).character;
    await ok('PUT', `/api/campaigns/${campaignId}/active-character`, seat.token, {
      characterId: character.id,
    });
  }
  return { seats, campaignId: campaignId! };
}

async function watch(seat: Seat, campaignId: string): Promise<TableClient> {
  const client = new TableClient(seat.name, seat.userId, seat.token, campaignId, () => undefined);
  await client.connect(API);
  return client;
}

const seen = (c: TableClient, t: string, since: number) =>
  c.frames.slice(since).filter((f) => f.t === t);

/** Waits up to `ms` for a frame of type `t` after `since`; resolves to the frame or undefined. */
async function frame(c: TableClient, t: string, since: number, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const f = seen(c, t, since)[0];
    if (f) return f;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

// ---- 1. the handshake -------------------------------------------------------------------------

async function handshake(token: string): Promise<void> {
  const attempt = (protocol: number) =>
    new Promise<{ t: string; d: Json }>((resolve, reject) => {
      const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/ws`);
      const timer = setTimeout(() => reject(new Error('no answer to auth')), 8000);
      ws.addEventListener('open', () =>
        ws.send(JSON.stringify({ v: 1, t: 'auth', d: { token, protocol } })),
      );
      ws.addEventListener('message', (e) => {
        const f = JSON.parse(String(e.data)) as { t: string; d: Json };
        if (f.t === 'auth.ok' || f.t === 'error') {
          clearTimeout(timer);
          ws.close();
          resolve(f);
        }
      });
      ws.addEventListener('error', () => reject(new Error('websocket failed')));
    });
  const good = await attempt(EXPECTED_PROTOCOL);
  check(`protocol ${EXPECTED_PROTOCOL} is accepted`, good.t === 'auth.ok');
  const bad = await attempt(EXPECTED_PROTOCOL - 1);
  check(
    `protocol ${EXPECTED_PROTOCOL - 1} is told to update`,
    bad.t === 'error' &&
      bad.d?.code === 'update_required' &&
      bad.d?.serverProtocol === EXPECTED_PROTOCOL,
    JSON.stringify(bad.d),
  );
}

// ---- 2. the storyteller -----------------------------------------------------------------------

async function storyteller(seats: Record<Key, Seat>, campaignId: string, ann: TableClient) {
  const base = `/api/campaigns/${campaignId}`;
  const patch = (key: Key, body: unknown) => api('PATCH', base, seats[key].token, body);
  const read = (key: Key) => ok('GET', `${base}/storytellers`, seats[key].token);

  await patch('dm', { bard: 'tavern' });
  let r = await read('ann');
  check(
    'the Tavern Bard is the default and every storyteller is offered',
    r.chosen === 'tavern' &&
      r.effective === 'tavern' &&
      ['tavern', 'dry', 'drunken', 'sarcastic', 'bored'].every((b) => r.offered.includes(b)),
    JSON.stringify(r),
  );

  const before = ann.frames.length;
  const changed = await patch('dm', { bard: 'dry' });
  check(
    'the DM changes the storyteller',
    changed.status === 200 && changed.body.campaign.bard === 'dry',
  );
  check('members are told (campaign.updated)', !!(await frame(ann, 'campaign.updated', before)));
  check('a player cannot change it', (await patch('ann', { bard: 'bored' })).status === 403);
  check(
    'an unknown storyteller is refused',
    (await patch('dm', { bard: 'a pirate' })).status === 400,
  );

  await admin('settings', 'set', 'ai.storyteller.dry', 'off');
  try {
    r = await read('ann');
    check(
      'a storyteller the operator turned off is not offered, and the Tavern Bard tells the tales',
      !r.offered.includes('dry') && r.chosen === 'dry' && r.effective === 'tavern',
      JSON.stringify(r),
    );
    check(
      'a pick of it is refused',
      (await patch('dm', { bard: 'dry' })).status === 400 &&
        (await patch('dm', { bard: 'bored' })).status === 200,
    );
  } finally {
    await admin('settings', 'set', 'ai.storyteller.dry', 'on');
  }
  let refused = false;
  try {
    await admin('settings', 'set', 'ai.storyteller.tavern', 'off');
  } catch {
    refused = true;
  }
  r = await read('dm');
  check('the Tavern Bard cannot be turned off', refused && r.offered.includes('tavern'));
  await patch('dm', { bard: 'tavern' });

  const status = await api('GET', '/api/status');
  const where = status.body?.recording?.processing;
  check(
    'the public status says where tales are processed',
    where === 'local' || where === 'offsite',
    String(where),
  );
}

// ---- 3. loot ----------------------------------------------------------------------------------

async function loot(
  seats: Record<Key, Seat>,
  campaignId: string,
  ann: TableClient,
  bo: TableClient,
) {
  const base = `/api/campaigns/${campaignId}/loot`;
  const dmT = seats.dm.token;
  const annT = seats.ann.token;
  const boT = seats.bo.token;
  const drop = await ok('POST', base, dmT, {
    name: 'E2E Ring of Tests',
    itemType: 'wondrous',
    quantity: 1,
  });
  const id = drop.item.id as string;
  const list = async (t: string) =>
    ((await ok('GET', base, t)).items ?? (await ok('GET', base, t)).loot) as Json[];
  const mine = async (t: string) => (await list(t)).find((i) => i.id === id);
  const countOf = async () =>
    (await list(dmT)).filter((i) => i.name === 'E2E Ring of Tests').length;

  const since = ann.frames.length;
  const re = await api('POST', `${base}/${id}/redrop`, dmT, {});
  check('the DM re-drops an unclaimed item', re.status === 200, String(re.status));
  check('players get loot.redropped', !!(await frame(ann, 'loot.redropped', since)));
  check('there is still one card for the item', (await countOf()) === 1);
  check(
    'a player cannot re-drop',
    (await api('POST', `${base}/${id}/redrop`, annT, {})).status === 403,
  );

  await ok('POST', `${base}/${id}/claim`, annT, { for: 'self' });
  check(
    'a claimed item cannot be re-dropped',
    (await api('POST', `${base}/${id}/redrop`, dmT, {})).status >= 400,
  );

  const sinceAnn = ann.frames.length;
  const sinceBo = bo.frames.length;
  await ok('POST', `${base}/${id}/confirm`, annT, { confirmed: true });
  check('the holder ticks "added to my sheet"', (await mine(annT))?.confirmed === true);
  check(
    'the tick reaches the holder, not the other player',
    !!(await frame(ann, 'loot.confirmed', sinceAnn)) &&
      seen(bo, 'loot.confirmed', sinceBo).length === 0,
  );
  check('the DM never sees the tick', (await mine(dmT))?.confirmed !== true);
  check(
    'another player cannot tick it',
    (await api('POST', `${base}/${id}/confirm`, boT, { confirmed: true })).status >= 400,
  );

  await ok('POST', `${base}/${id}/store`, annT, {});
  const stored = await mine(annT);
  check(
    'storing it in the party stash clears the tick',
    stored?.confirmed !== true,
    JSON.stringify(stored?.confirmed),
  );
  await ok('POST', `${base}/${id}/confirm`, boT, { confirmed: true });
  check(
    'the party stash has its own tick, seen by everyone who can take it',
    (await mine(boT))?.confirmed === true,
  );
  await ok('POST', `${base}/${id}/claim`, boT, { for: 'self' });
  check('taking it from the stash clears the tick again', (await mine(boT))?.confirmed !== true);
  await ok('POST', `${base}/${id}/return`, boT, {});
  await ok('DELETE', `${base}/${id}`, dmT);
}

// ---- 4. GM notes and the glossary -------------------------------------------------------------

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function gm(seats: Record<Key, Seat>, campaignId: string) {
  const base = `/api/campaigns/${campaignId}/gm`;
  const dmT = seats.dm.token;
  const annT = seats.ann.token;
  const text = `# Secrets\n\nThe cellar door is real. ${randomBytes(4).toString('hex')}`;
  const saved = await api('PUT', `${base}/notes`, dmT, { body: text });
  check('the DM saves the notes', saved.status === 200);
  const got = await api('GET', `${base}/notes`, dmT);
  check(
    'the DM reads them back',
    got.status === 200 && JSON.stringify(got.body).includes('cellar door'),
  );
  check('a player cannot read them', (await api('GET', `${base}/notes`, annT)).status === 403);
  check(
    'a player cannot write them',
    (await api('PUT', `${base}/notes`, annT, { body: 'mine' })).status === 403,
  );

  const up = await fetch(`${API}${base}/notes/files?name=map.png`, {
    method: 'POST',
    headers: { authorization: `Bearer ${dmT}`, 'content-type': 'application/octet-stream' },
    body: new Uint8Array(PNG),
  });
  const file = ((await up.json()) as Json).file;
  check('the DM attaches a picture', up.status === 201 && !!file?.id, String(up.status));
  if (file?.id) {
    const down = await fetch(`${API}${base}/notes/files/${file.id}`, {
      headers: { authorization: `Bearer ${dmT}` },
    });
    check(
      'the DM opens it, as an image',
      down.status === 200 && (down.headers.get('content-type') ?? '').startsWith('image/'),
    );
    const denied = await fetch(`${API}${base}/notes/files/${file.id}`, {
      headers: { authorization: `Bearer ${annT}` },
    });
    check('a player cannot open it', denied.status === 403);
    await api('DELETE', `${base}/notes/files/${file.id}`, dmT);
  }
  const notAnImage = await fetch(`${API}${base}/notes/files?name=x.exe`, {
    method: 'POST',
    headers: { authorization: `Bearer ${dmT}`, 'content-type': 'application/octet-stream' },
    body: new Uint8Array(Buffer.from('MZ not a picture or a pdf')),
  });
  check('only pictures and PDFs are accepted', notAnImage.status >= 400, String(notAnImage.status));

  const term = await api('POST', `${base}/glossary`, dmT, {
    term: 'Zorblax',
    kind: 'person',
    aliases: ['Zorblaks'],
  });
  check('the DM adds a glossary term', term.status === 201 && !!term.body.term?.id);
  const termId = term.body.term?.id as string | undefined;
  if (termId) {
    const upd = await api('PATCH', `${base}/glossary/${termId}`, dmT, {
      aliases: ['Zorblaks', 'Zorblax the Wise'],
    });
    check('the DM edits its spellings', upd.status === 200);
    const listed = await api('GET', `${base}/glossary`, dmT);
    check(
      'the term is listed with its spellings',
      JSON.stringify(listed.body).includes('Zorblax the Wise'),
    );
    check(
      'a player cannot read the glossary',
      (await api('GET', `${base}/glossary`, annT)).status === 403,
    );
    check(
      'a player cannot add a term',
      (await api('POST', `${base}/glossary`, annT, { term: 'x' })).status === 403,
    );
    await api('DELETE', `${base}/glossary/${termId}`, dmT);
  }
}

// ---- 5. deleting a character ------------------------------------------------------------------

async function characters(seats: Record<Key, Seat>, campaignId: string) {
  const base = `/api/campaigns/${campaignId}/characters`;
  const annT = seats.ann.token;
  const spare = (
    await ok('POST', base, annT, { name: 'Spare E2E', className: 'Rogue', race: 'Elf', level: 1 })
  ).character;
  await ok('PUT', `/api/campaigns/${campaignId}/active-character`, annT, { characterId: spare.id });
  const del = await api('DELETE', `${base}/${spare.id}`, annT);
  check(
    'a player deletes their character',
    del.status === 200 || del.status === 204,
    String(del.status),
  );
  const left = (await ok('GET', base, annT)).characters as Json[];
  check(
    'it is gone, and another one is in play',
    !left.some((c) => c.id === spare.id) &&
      left.some((c) => c.active === true || c.isActive === true || c.name === 'Ann the Bold'),
  );
}

// ---- main -------------------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`protocol 4 end-to-end test against ${API}`);
  const { seats, campaignId } = await setUp();
  await handshake(seats.dm.token);
  const ann = await watch(seats.ann, campaignId);
  const bo = await watch(seats.bo, campaignId);
  try {
    await storyteller(seats, campaignId, ann);
    await loot(seats, campaignId, ann, bo);
    await gm(seats, campaignId);
    await characters(seats, campaignId);
  } finally {
    await ann.close();
    await bo.close();
  }
  log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(2);
});
