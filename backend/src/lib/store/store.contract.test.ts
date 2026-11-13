import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Campaign, JoinRequest, Membership, SignupRequest } from '../../types/index.js';
import { migrate } from './migrate.js';
import { createPool } from './postgresStore.js';
import type { Store } from './store.js';
import { openTestBackend, TEST_DATABASE_URL } from './testing.js';

/** Behaviour every `Store` must share. Runs on MemoryStore always, and on Postgres when TEST_DATABASE_URL is set. */
const backend = await openTestBackend();
afterAll(() => backend.close());

let store: Store;
beforeEach(async () => {
  store = await backend.reset();
});

const campaign = (): Campaign => ({
  id: backend.newId(),
  name: 'Curse of Strahd',
  createdAt: 1,
  allowJoin: true,
});
const membership = (c: Campaign, userId: string, role: 'dm' | 'player'): Membership => ({
  campaignId: c.id,
  userId,
  role,
  activeCharacterId: null,
  suspendedCharacterId: null,
  joinedAt: 1,
});

const person = (id: string, displayName: string) => ({
  id,
  email: `${displayName.toLowerCase()}@x.test`,
  displayName,
  passwordHash: null,
  isAdmin: false,
  consentVersion: '1',
  consentAt: 1,
  createdAt: 1,
});
const joinRequest = (campaignId: string, userId: string, at = 1): JoinRequest => ({
  id: backend.newId(),
  campaignId,
  userId,
  message: 'hello',
  status: 'pending',
  createdAt: at,
  decidedAt: null,
  decidedBy: null,
});

describe(`Store contract (${backend.kind})`, () => {
  it('lists open campaigns with the DM name and player count, never member names', async () => {
    const [dm, p1, p2] = [backend.newId(), backend.newId(), backend.newId()];
    for (const [id, name] of [
      [dm, 'Dana'],
      [p1, 'Pat'],
      [p2, 'Quinn'],
    ] as const) {
      await store.putUser(person(id, name));
    }
    const open = campaign();
    const closed = { ...campaign(), name: 'Closed table', allowJoin: false };
    for (const c of [open, closed]) {
      await store.putCampaign(c);
      await store.putMembership(membership(c, dm, 'dm'));
      await store.putMembership(membership(c, p1, 'player'));
    }
    await store.putMembership(membership(open, p2, 'player'));
    expect(await store.listOpenCampaigns()).toEqual([
      { id: open.id, name: 'Curse of Strahd', dmName: 'Dana', playerCount: 2 },
    ]);
    expect(await store.setCampaignAllowJoin(closed.id, true)).toBe(true);
    expect(await store.setCampaignAllowJoin(open.id, false)).toBe(true);
    expect((await store.listOpenCampaigns()).map((c) => c.id)).toEqual([closed.id]);
    expect((await store.getCampaign(open.id))?.allowJoin).toBe(false);
    expect(await store.setCampaignAllowJoin(backend.newId(), true)).toBe(false);
  });

  it('defaults a new campaign to Allow join on', async () => {
    const c = campaign();
    await store.putCampaign(c);
    expect((await store.getCampaign(c.id))?.allowJoin).toBe(true);
  });

  it('keeps one pending join request per person per campaign, and lists them by campaign and user', async () => {
    const [u1, u2] = [backend.newId(), backend.newId()];
    await store.putUser(person(u1, 'One'));
    await store.putUser(person(u2, 'Two'));
    const c1 = campaign();
    const c2 = campaign();
    await store.putCampaign(c1);
    await store.putCampaign(c2);
    const first = joinRequest(c1.id, u1, 1);
    expect(await store.createJoinRequest(first)).toBe(true);
    expect(await store.createJoinRequest(joinRequest(c1.id, u1, 2))).toBe(false);
    expect(await store.createJoinRequest(joinRequest(c2.id, u1, 3))).toBe(true);
    expect(await store.createJoinRequest(joinRequest(c1.id, u2, 4))).toBe(true);

    expect(await store.getJoinRequest(first.id)).toEqual(first);
    expect(await store.getJoinRequest(backend.newId())).toBeUndefined();
    expect((await store.listJoinRequestsForCampaign(c1.id)).map((r) => r.userId)).toEqual([u1, u2]);
    expect((await store.listJoinRequestsForUser(u1)).map((r) => r.campaignId)).toEqual([
      c1.id,
      c2.id,
    ]);
    expect(await store.countOpenJoinRequestsByUser(u1)).toBe(2);

    expect(await store.decideJoinRequest(first.id, 'declined', u2, 9)).toBe(true);
    expect(await store.decideJoinRequest(first.id, 'approved', u2, 10)).toBe(false);
    expect(await store.getJoinRequest(first.id)).toMatchObject({
      status: 'declined',
      decidedBy: u2,
      decidedAt: 9,
    });
    expect(await store.listJoinRequestsForCampaign(c1.id, 'pending')).toHaveLength(1);
    expect(await store.listJoinRequestsForUser(u1, 'declined')).toHaveLength(1);
    expect(await store.countOpenJoinRequestsByUser(u1)).toBe(1);
    // A decided request frees the slot for a new one.
    expect(await store.createJoinRequest(joinRequest(c1.id, u1, 11))).toBe(true);
  });

  it('rolls back every write in a failed transaction', async () => {
    const c = campaign();
    await expect(
      store.transaction(async (tx) => {
        await tx.putCampaign(c);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await store.getCampaign(c.id)).toBeUndefined();
  });

  it('lists uploaded portraits nobody uses any more, and only old enough ones', async () => {
    const owner = backend.newId();
    await store.putUser({
      id: owner,
      email: 'p@x.test',
      displayName: 'P',
      passwordHash: null,
      isAdmin: false,
      consentVersion: '1',
      consentAt: 1,
      createdAt: 1,
      avatarUrl: 'avatar:used-by-account',
    });
    await store.recordAvatarFile('used-by-account', owner, 10);
    await store.recordAvatarFile('replaced', owner, 10);
    await store.recordAvatarFile('fresh', owner, 500);
    expect((await store.listUnusedAvatarFiles(100)).sort()).toEqual(['replaced']);
    await store.deleteAvatarFile('replaced');
    expect(await store.listUnusedAvatarFiles(100)).toEqual([]);
  });

  it('stores device requests: lookup by id and code hash, expiry cleanup, one delivery', async () => {
    const base = {
      deviceLabel: 'Laptop',
      requestIp: '10.0.0.1',
      createdAt: 1,
      approvedUserId: null,
      deliveredAt: null,
    };
    const live = {
      ...base,
      id: backend.newId(),
      userCodeHash: 'h-live',
      pollSecretHash: 's1',
      expiresAt: 1000,
    };
    const old = {
      ...base,
      id: backend.newId(),
      userCodeHash: 'h-old',
      pollSecretHash: 's2',
      expiresAt: 10,
    };
    await store.putDeviceRequest(live);
    await store.putDeviceRequest(old);
    expect(await store.getDeviceRequest(live.id)).toEqual(live);
    expect(await store.getDeviceRequestByCodeHash('h-old')).toEqual(old);
    expect(await store.getDeviceRequest(backend.newId())).toBeUndefined();
    expect(await store.getDeviceRequestByCodeHash('nope')).toBeUndefined();

    await store.deleteExpiredDeviceRequests(100);
    expect(await store.getDeviceRequest(old.id)).toBeUndefined();
    expect(await store.getDeviceRequest(live.id)).toEqual(live);

    const ann = backend.newId();
    const bob = backend.newId();
    for (const [id, name] of [
      [ann, 'ann'],
      [bob, 'bob'],
    ] as const) {
      await store.putUser({
        id,
        email: `${name}@x.test`,
        displayName: name,
        passwordHash: null,
        isAdmin: false,
        consentVersion: '1',
        consentAt: 1,
        createdAt: 1,
      });
    }
    expect(await store.markDeviceRequestApproved(live.id, ann, 2000)).toBe(false); // expired
    expect(await store.markDeviceRequestApproved(live.id, ann, 50)).toBe(true);
    expect(await store.markDeviceRequestApproved(live.id, bob, 51)).toBe(false);
    expect((await store.getDeviceRequest(live.id))?.approvedUserId).toBe(ann);

    expect(await store.markDeviceRequestDelivered(live.id, 50)).toBe(true);
    expect(await store.markDeviceRequestDelivered(live.id, 60)).toBe(false);
    expect((await store.getDeviceRequest(live.id))?.deliveredAt).toBe(50);
  });

  it('commits a successful transaction and returns its value', async () => {
    const c = campaign();
    const result = await store.transaction(async (tx) => {
      await tx.putCampaign(c);
      return 42;
    });
    expect(result).toBe(42);
    expect(await store.getCampaign(c.id)).toEqual(c);
  });

  it('stores a chat line\u2019s kind and language and gives them back', async () => {
    const c = campaign();
    await store.putCampaign(c);
    const owner = backend.newId();
    await store.putUser({
      id: owner,
      email: 'k@x.test',
      displayName: 'K',
      passwordHash: null,
      isAdmin: false,
      consentVersion: '1',
      consentAt: 1,
      createdAt: 1,
    });
    const base = { campaignId: c.id, senderId: owner, senderName: 'K', recipientId: null };
    await store.putChatMessage({
      ...base,
      id: backend.newId(),
      text: 'a',
      at: 1,
      kind: 'say',
      lang: 'elvish',
    });
    await store.putChatMessage({ ...base, id: backend.newId(), text: 'b', at: 2, kind: 'ooc' });
    await store.putChatMessage({ ...base, id: backend.newId(), text: 'c', at: 3, kind: 'chat' });
    const lines = await store.listChat(c.id, owner, { limit: 10 });
    expect(lines.map((m) => [m.kind, m.lang])).toEqual([
      ['say', 'elvish'],
      ['ooc', undefined],
      ['chat', undefined],
    ]);
  });

  it('upserts: a second put replaces the first', async () => {
    const c = campaign();
    await store.putCampaign(c);
    await store.putCampaign({ ...c, name: 'Renamed' });
    expect((await store.getCampaign(c.id))?.name).toBe('Renamed');
  });

  it('treats an id that was never issued — even a malformed one — as not found', async () => {
    expect(await store.getUser('not-a-uuid')).toBeUndefined();
    expect(await store.getSession('bogus')).toBeUndefined();
    expect(await store.getCampaign('../etc/passwd')).toBeUndefined();
    expect(await store.listMemberships('nope')).toEqual([]);
  });

  it('round-trips AI settings, including the remote URL and the fallback policy', async () => {
    const settings = await store.getSettings();
    expect(settings.ai.transcription.kind).toBe('local');
    await store.putSettings({
      ...settings,
      ai: {
        ...settings.ai,
        transcription: { ...settings.ai.transcription, kind: 'remote', url: 'http://gpu:8080' },
        fallback: { enabled: false, afterSeconds: 90, retrySeconds: 5 },
      },
    });
    const back = await store.getSettings();
    expect(back.ai.transcription).toMatchObject({ kind: 'remote', url: 'http://gpu:8080' });
    expect(back.ai.fallback).toEqual({ enabled: false, afterSeconds: 90, retrySeconds: 5 });
  });

  it('returns the seeded default settings on a fresh store', async () => {
    expect(await store.getSettings()).toMatchObject({
      campaignCreation: 'closed',
      offlineLimitDays: 30,
    });
  });
});

describe('sign-up requests', () => {
  const request = (email: string, createdAt: number): SignupRequest => ({
    id: backend.newId(),
    email,
    displayName: 'Visitor',
    message: '',
    status: 'pending',
    createdAt,
    decidedAt: null,
  });

  it('stores, updates and lists requests oldest first, filtered by status', async () => {
    const a = request('a@x.test', 2);
    const b = request('b@x.test', 1);
    await store.putSignupRequest(a);
    await store.putSignupRequest(b);
    expect((await store.listSignupRequests()).map((r) => r.email)).toEqual([
      'b@x.test',
      'a@x.test',
    ]);
    await store.putSignupRequest({ ...b, status: 'approved', decidedAt: 5 });
    expect((await store.listSignupRequests('pending')).map((r) => r.email)).toEqual(['a@x.test']);
    expect(await store.getSignupRequest(b.id)).toMatchObject({ status: 'approved', decidedAt: 5 });
    expect(await store.getSignupRequest(backend.newId())).toBeUndefined();
  });

  it('keeps the audio-purge-next-session setting, off by default', async () => {
    expect((await store.getSettings()).audioPurgeOnNextSession).toBe('off');
    await store.putSettings({ ...(await store.getSettings()), audioPurgeOnNextSession: 'on' });
    expect((await store.getSettings()).audioPurgeOnNextSession).toBe('on');
  });

  it('keeps the signup-requests setting, off by default', async () => {
    expect((await store.getSettings()).signupRequests).toBe('off');
    await store.putSettings({ ...(await store.getSettings()), signupRequests: 'on' });
    expect((await store.getSettings()).signupRequests).toBe('on');
  });
});

// Constraints only a real database enforces — the point of running against one.
describe.skipIf(backend.kind !== 'postgres')('Postgres constraints', () => {
  async function user(email: string): Promise<string> {
    const id = backend.newId();
    await store.putUser({
      id,
      email,
      displayName: email,
      passwordHash: null,
      isAdmin: false,
      consentVersion: '1',
      consentAt: 1,
      createdAt: 1,
    });
    return id;
  }

  it('refuses a second DM in one campaign', async () => {
    const c = campaign();
    await store.putCampaign(c);
    await store.putMembership(membership(c, await user('a@x.test'), 'dm'));
    await expect(
      store.putMembership(membership(c, await user('b@x.test'), 'dm')),
    ).rejects.toThrow();
  });

  it('refuses a DM with an active character', async () => {
    const c = campaign();
    await store.putCampaign(c);
    const u = await user('a@x.test');
    const characterId = backend.newId();
    await store.putCharacter({
      id: characterId,
      userId: u,
      campaignId: c.id,
      name: 'Ireena',
      className: null,
      race: null,
      level: null,
      avatarUrl: null,
      sourceUrl: null,
      syncedAt: null,
      sourceAvatar: null,
      sheet: null,
    });
    await expect(
      store.putMembership({ ...membership(c, u, 'dm'), activeCharacterId: characterId }),
    ).rejects.toThrow();
  });

  it('refuses a duplicate email', async () => {
    await user('dup@x.test');
    await expect(user('dup@x.test')).rejects.toThrow();
  });

  it('leaves nothing behind when a DM swap fails half way', async () => {
    const c = campaign();
    await store.putCampaign(c);
    const dm = await user('dm@x.test');
    const player = await user('p@x.test');
    await store.putMembership(membership(c, dm, 'dm'));
    await store.putMembership(membership(c, player, 'player'));
    await expect(
      store.transaction(async (tx) => {
        await tx.putMembership(membership(c, dm, 'player'));
        await tx.putMembership(membership(c, player, 'dm'));
        throw new Error('crash before commit');
      }),
    ).rejects.toThrow();
    expect((await store.getMembership(c.id, dm))?.role).toBe('dm');
    expect((await store.getMembership(c.id, player))?.role).toBe('player');
  });

  it('demote-then-promote inside a transaction satisfies the one-DM index', async () => {
    const c = campaign();
    await store.putCampaign(c);
    const dm = await user('dm@x.test');
    const player = await user('p@x.test');
    await store.putMembership(membership(c, dm, 'dm'));
    await store.putMembership(membership(c, player, 'player'));
    await store.transaction(async (tx) => {
      await tx.putMembership(membership(c, dm, 'player'));
      await tx.putMembership(membership(c, player, 'dm'));
    });
    expect((await store.getMembership(c.id, player))?.role).toBe('dm');
  });
});

describe.skipIf(TEST_DATABASE_URL === undefined)('migrate', () => {
  it('applies on an empty schema, then is a no-op', async () => {
    const schema = `m_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = createPool(TEST_DATABASE_URL ?? '', { options: `-c search_path=${schema}` });
    try {
      expect(await migrate(pool)).toEqual([
        '0001_init.sql',
        '0002_ai_settings.sql',
        '0003_records.sql',
        '0004_recording_events.sql',
        '0005_records_search.sql',
        '0006_chat.sql',
        '0007_handouts.sql',
        '0008_loot.sql',
        '0009_soundboard.sql',
        '0010_schedule.sql',
        '0011_loot_party.sql',
        '0012_session_duration.sql',
        '0013_loot_types.sql',
        '0014_loot_assigned.sql',
        '0015_recording_event_detail.sql',
        '0016_user_avatar.sql',
        '0017_character_sync.sql',
        '0018_avatar_files.sql',
        '0019_handout_files.sql',
        '0020_recording_chat.sql',
        '0021_track_purged.sql',
        '0022_character_sheet.sql',
        '0023_audio_notice.sql',
        '0024_link_purpose.sql',
        '0025_device_requests.sql',
        '0026_signup_requests.sql',
        '0027_chat_kind.sql',
        '0028_join_requests.sql',
        '0029_chapter_summaries.sql',
        '0030_audio_purge_on_next_session.sql',
      ]);
      expect(await migrate(pool)).toEqual([]);
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
});
