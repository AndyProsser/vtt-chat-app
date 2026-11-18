import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MediaStorage } from '../media/mediaStorage.js';
import { openTestBackend, type TestBackend } from '../store/testing.js';
import {
  ArchiveError,
  exportCampaign,
  importCampaign,
  NOT_EXPORTED,
  readArchive,
  TABLES,
  unprocessedRecordings,
  writeArchive,
  type CampaignExport,
} from './campaignArchive.js';

// Needs Postgres (TEST_DATABASE_URL): the archive reads and writes rows with to_jsonb / jsonb_populate_record.
let backend: TestBackend;
beforeAll(async () => {
  backend = await openTestBackend();
});
afterAll(async () => {
  await backend.close();
});

const run = backend_kind();
function backend_kind(): boolean {
  return Boolean(process.env.TEST_DATABASE_URL);
}

/** The file as bytes, written the way the CLI writes it. */
async function pack(exported: CampaignExport, media?: MediaStorage) {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      chunks.push(chunk);
      done();
    },
  });
  const { missingMedia } = await writeArchive(exported, sink, media);
  return { bytes: Buffer.concat(chunks), missingMedia };
}

function memoryMedia(): MediaStorage & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    put: async (id, bytes) => void files.set(id, bytes),
    get: async (id) => files.get(id),
    delete: async (id) => void files.delete(id),
  };
}

interface Seed {
  campaign: string;
  dm: string;
  player: string;
  media: string;
  recording: string;
  unfinished: string;
}

async function seed(): Promise<Seed> {
  await backend.reset();
  await backend.pool!.query('TRUNCATE media_files CASCADE');
  const pool = backend.pool!;
  const q = (text: string, values: unknown[] = []) => pool.query(text, values);
  const s: Seed = {
    campaign: randomUUID(),
    dm: randomUUID(),
    player: randomUUID(),
    media: randomUUID(),
    recording: randomUUID(),
    unfinished: randomUUID(),
  };
  const user = (id: string, email: string, name: string) =>
    q(
      `INSERT INTO users (id, email, display_name, consent_version, consent_at, created_at)
       VALUES ($1, $2, $3, '1', 1, 1)`,
      [id, email, name],
    );
  await user(s.dm, 'dm@example.com', 'Dee');
  await user(s.player, 'pc@example.com', 'Pat');
  await q(`INSERT INTO campaigns (id, name, created_at) VALUES ($1, 'Strahd', 1)`, [s.campaign]);
  const character = randomUUID();
  await q(
    `INSERT INTO characters (id, user_id, campaign_id, name, class_name, level) VALUES ($1, $2, $3, 'Brann', 'Cleric', 3)`,
    [character, s.player, s.campaign],
  );
  await q(
    `INSERT INTO memberships (campaign_id, user_id, role, joined_at) VALUES ($1, $2, 'dm', 1)`,
    [s.campaign, s.dm],
  );
  await q(
    `INSERT INTO memberships (campaign_id, user_id, role, active_character_id, joined_at) VALUES ($1, $2, 'player', $3, 2)`,
    [s.campaign, s.player, character],
  );
  await q(
    `INSERT INTO chat_messages (id, campaign_id, sender_id, sender_name, text, at) VALUES ($1, $2, $3, 'Pat', 'hello', 5)`,
    [randomUUID(), s.campaign, s.player],
  );
  await q(
    `INSERT INTO media_files (id, owner_id, kind, mime, bytes, sha256, original_name, created_at)
     VALUES ($1, $2, 'image', 'image/png', 4, 'x', 'map.png', 1)`,
    [s.media, s.dm],
  );
  const handout = randomUUID();
  await q(
    `INSERT INTO handouts (id, campaign_id, title, kind, visibility, created_by, created_at)
     VALUES ($1, $2, 'Map', 'image', 'all', $3, 1)`,
    [handout, s.campaign, s.dm],
  );
  await q(`INSERT INTO handout_files (handout_id, position, media_id) VALUES ($1, 0, $2)`, [
    handout,
    s.media,
  ]);
  await q(
    `INSERT INTO loot_items (id, campaign_id, name, quantity, dropped_by, dropped_at, claimed_by, claimed_at, kind)
     VALUES ($1, $2, 'Sword', 1, $3, 1, $4, 2, 'item')`,
    [randomUUID(), s.campaign, s.dm, s.player],
  );
  await q(
    `INSERT INTO recordings (id, campaign_id, started_at, stopped_at, status) VALUES ($1, $2, 10, 20, 'processed')`,
    [s.recording, s.campaign],
  );
  const track = randomUUID();
  await q(
    `INSERT INTO recording_tracks (id, recording_id, speaker_id, speaker_name, file_path, start_offset_ms, private)
     VALUES ($1, $2, $3, 'Pat', '/rec/a.ogg', 0, false)`,
    [track, s.recording, s.player],
  );
  await q(
    `INSERT INTO recording_events (recording_id, at, event, detail) VALUES ($1, 10, 'started', $2)`,
    [s.recording, JSON.stringify({ by: s.dm })],
  );
  await q(
    `INSERT INTO transcript_segments (track_id, seq, start_ms, end_ms, text) VALUES ($1, 0, 0, 5, 'we enter')`,
    [track],
  );
  await q(
    `INSERT INTO summaries (id, recording_id, kind, subject, visibility, text, model_calls, created_at)
     VALUES ($1, $2, 'session', '', 'members', 'a tale', 1, 30)`,
    [randomUUID(), s.recording],
  );
  await q(
    `INSERT INTO recordings (id, campaign_id, started_at, stopped_at, status) VALUES ($1, $2, 40, 50, 'stopped')`,
    [s.unfinished, s.campaign],
  );
  return s;
}

const count = async (table: string, where = 'TRUE', values: unknown[] = []) =>
  Number(
    (await backend.pool!.query(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, values)).rows[0]
      .n,
  );

describe.runIf(run)('campaign export and import', () => {
  it('lists every table that hangs off a campaign, or says why it is left out', async () => {
    const { rows } = await backend.pool!.query<{ child: string; parent: string }>(
      `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
         FROM pg_constraint c
        WHERE c.contype = 'f' AND c.connamespace = current_schema()::regnamespace`,
    );
    const tree = new Set(['campaigns']);
    for (let grew = true; grew;) {
      grew = false;
      for (const r of rows) {
        // media_files is reached through handout_files, which points the other way
        if (tree.has(r.parent) && !tree.has(r.child) && r.parent !== 'media_files') {
          tree.add(r.child);
          grew = true;
        }
      }
    }
    const known = new Set([...TABLES.map((t) => t.name), ...Object.keys(NOT_EXPORTED)]);
    expect([...tree].filter((t) => !known.has(t))).toEqual([]);
  });

  it('warns about a session with no transcript yet', async () => {
    const s = await seed();
    const unfinished = await unprocessedRecordings(backend.pool!, s.campaign);
    expect(unfinished.map((r) => r.id)).toEqual([s.unfinished]);
  });

  it('round-trips a campaign after it was deleted: same ids, text, files and members', async () => {
    const s = await seed();
    const media = memoryMedia();
    media.files.set(s.media, Buffer.from('PNG!'));
    const { bytes, missingMedia } = await pack(
      await exportCampaign(backend.pool!, s.campaign),
      media,
    );
    expect(missingMedia).toEqual([]);

    await backend.store.deleteCampaign(s.campaign);
    media.files.clear();
    expect(await count('recordings')).toBe(0);

    const result = await importCampaign(backend.pool!, readArchive(bytes), { media });
    expect(result).toMatchObject({ campaignId: s.campaign, matched: 2, created: [], files: 1 });
    expect(await count('campaigns', 'id = $1', [s.campaign])).toBe(1);
    expect(await count('memberships')).toBe(2);
    expect(await count('chat_messages')).toBe(1);
    expect(await count('loot_items', 'claimed_by = $1', [s.player])).toBe(1);
    expect(await count('transcript_segments')).toBe(1);
    expect(await count('summaries')).toBe(1);
    expect(await count('recording_events')).toBe(1);
    expect(media.files.get(s.media)?.toString()).toBe('PNG!');
    // a session that never got its transcript comes back as it was (the operator can reprocess it)
    const { rows } = await backend.pool!.query(`SELECT status FROM recordings WHERE id = $1`, [
      s.unfinished,
    ]);
    expect(rows[0].status).toBe('stopped');
  });

  it('refuses to overwrite a campaign that is still here, and makes a copy with --as-new', async () => {
    const s = await seed();
    const media = memoryMedia();
    media.files.set(s.media, Buffer.from('PNG!'));
    const { bytes } = await pack(await exportCampaign(backend.pool!, s.campaign), media);
    await expect(importCampaign(backend.pool!, readArchive(bytes), { media })).rejects.toThrow(
      ArchiveError,
    );

    const copy = await importCampaign(backend.pool!, readArchive(bytes), { media, asNew: true });
    expect(copy.campaignId).not.toBe(s.campaign);
    expect(await count('campaigns')).toBe(2);
    expect(await count('recordings')).toBe(4);
    expect(await count('campaigns', `name = 'Strahd (copy)'`)).toBe(1);
    expect(await count('media_files')).toBe(2);
    // the copy's membership points at the copy's own character
    expect(
      await count(
        'memberships m JOIN characters c ON c.id = m.active_character_id',
        'm.campaign_id = $1 AND c.campaign_id = $1',
        [copy.campaignId],
      ),
    ).toBe(1);
    // and its recordings' audio is marked gone, since the copy has none
    expect(
      await count(
        'recording_tracks t JOIN recordings r ON r.id = t.recording_id',
        'r.campaign_id = $1 AND t.purged_at IS NULL',
        [copy.campaignId],
      ),
    ).toBe(0);
  });

  it('makes a placeholder account for a member with no account here, and matches the rest by email', async () => {
    const s = await seed();
    const media = memoryMedia();
    media.files.set(s.media, Buffer.from('PNG!'));
    const { bytes } = await pack(await exportCampaign(backend.pool!, s.campaign), media);
    await backend.store.deleteCampaign(s.campaign);
    await backend.pool!.query('DELETE FROM users WHERE id = $1', [s.player]);
    const result = await importCampaign(backend.pool!, readArchive(bytes), { media });
    expect(result.matched).toBe(1);
    expect(result.created.map((u) => u.email)).toEqual(['pc@example.com']);
    const { rows } = await backend.pool!.query(
      `SELECT password_hash FROM users WHERE email = 'pc@example.com'`,
    );
    expect(rows[0].password_hash).toBeNull();
  });

  it('rejects a file that is not an export, and rolls back on a failure', async () => {
    expect(() => readArchive(Buffer.from('nope'))).toThrow(ArchiveError);
    const s = await seed();
    const media = memoryMedia();
    media.files.set(s.media, Buffer.from('PNG!'));
    const exported = await exportCampaign(backend.pool!, s.campaign);
    exported.tables.summaries![0]!.kind = 'not-a-kind';
    const { bytes } = await pack(exported, media);
    await backend.store.deleteCampaign(s.campaign);
    const target = memoryMedia();
    await expect(
      importCampaign(backend.pool!, readArchive(bytes), { media: target }),
    ).rejects.toThrow();
    expect(await count('campaigns')).toBe(0);
    expect(await count('users')).toBe(2);
    expect(target.files.size).toBe(0);
  });

  it('is a zip: a manifest first, one data file per table, and the handout file as it is', async () => {
    const s = await seed();
    const media = memoryMedia();
    media.files.set(s.media, Buffer.from('PNG!'));
    const { bytes } = await pack(await exportCampaign(backend.pool!, s.campaign), media);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    const source = readArchive(bytes);
    expect(source.manifest).toMatchObject({
      format: 'vtt-campaign',
      campaign: { id: s.campaign, name: 'Strahd' },
      files: [s.media],
    });
    expect(source.manifest.counts.recordings).toBe(2);
    expect(source.rows('chat_messages')).toHaveLength(1);
    expect(Buffer.from(source.file(s.media)!).toString()).toBe('PNG!');
  });

  it('will not export a campaign with handout files when there is nowhere to read them from', async () => {
    const s = await seed();
    await expect(pack(await exportCampaign(backend.pool!, s.campaign))).rejects.toThrow(
      /MEDIA_DIR/,
    );
  });
});
