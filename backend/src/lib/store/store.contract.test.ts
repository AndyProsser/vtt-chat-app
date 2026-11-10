import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Campaign, Membership } from '../../types/index.js';
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

const campaign = (): Campaign => ({ id: backend.newId(), name: 'Curse of Strahd', createdAt: 1 });
const membership = (c: Campaign, userId: string, role: 'dm' | 'player'): Membership => ({
  campaignId: c.id,
  userId,
  role,
  activeCharacterId: null,
  suspendedCharacterId: null,
  joinedAt: 1,
});

describe(`Store contract (${backend.kind})`, () => {
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

  it('commits a successful transaction and returns its value', async () => {
    const c = campaign();
    const result = await store.transaction(async (tx) => {
      await tx.putCampaign(c);
      return 42;
    });
    expect(result).toBe(42);
    expect(await store.getCampaign(c.id)).toEqual(c);
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
      ]);
      expect(await migrate(pool)).toEqual([]);
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
});
