import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import type pg from 'pg';

import type { MediaStorage } from '../media/mediaStorage.js';

/**
 * Export and import of ONE campaign (not a server backup; that is the operator's own backup of the database and
 * the recordings folder). Text only: the campaign, its members and characters, chat, handouts with their pictures
 * and PDFs, loot, the schedule, and every recording's transcript, notes and summaries. The raw audio is not in it
 * (it is covered by the server backup), and neither are the things that belong to a person rather than a campaign
 * (sound libraries, soundboards, scenes, portraits) or are secret or short-lived (invite codes, join requests,
 * notifications, queued jobs). See docs/architecture/CAMPAIGN-EXPORT.md.
 *
 * It reads and writes rows as JSON with `to_jsonb` / `jsonb_populate_record`, driven by the table list below, so a
 * new column in an existing table is carried without touching this file; a new table is not, and the test that
 * walks the schema's foreign keys fails until the table is listed here or named in `NOT_EXPORTED`.
 */

export const ARCHIVE_FORMAT = 'vtt-campaign';
export const ARCHIVE_VERSION = 1;

interface TableSpec {
  name: string;
  /** Selects this table's rows for campaign `$1`. */
  where: string;
  order?: string;
  /** Primary-key columns made new when importing as a copy. */
  ids?: string[];
  /** Columns that point at another exported row (follow the new ids). */
  refs?: string[];
  /** Columns that hold an account id. */
  users?: string[];
  /** A text column that may hold an account id (a speaker). */
  userText?: string[];
  /** Columns the database numbers itself. */
  drop?: string[];
}

const IN_CAMPAIGN_RECORDINGS = `recording_id IN (SELECT id FROM recordings WHERE campaign_id = $1)`;
const IN_CAMPAIGN_HANDOUTS = `handout_id IN (SELECT id FROM handouts WHERE campaign_id = $1)`;
const IN_CAMPAIGN_SESSIONS = `session_id IN (SELECT id FROM scheduled_sessions WHERE campaign_id = $1)`;

/** In the order they can be inserted: a row's parents come first. */
export const TABLES: readonly TableSpec[] = [
  { name: 'campaigns', where: 'id = $1', ids: ['id'] },
  {
    name: 'characters',
    where: 'campaign_id = $1',
    ids: ['id'],
    refs: ['campaign_id'],
    users: ['user_id'],
  },
  {
    name: 'memberships',
    where: 'campaign_id = $1',
    refs: ['campaign_id', 'active_character_id', 'suspended_character_id'],
    users: ['user_id'],
  },
  {
    name: 'chat_messages',
    where: 'campaign_id = $1',
    order: 'at',
    ids: ['id'],
    refs: ['campaign_id'],
    users: ['sender_id', 'recipient_id'],
  },
  {
    name: 'media_files',
    where: `id IN (SELECT hf.media_id FROM handout_files hf JOIN handouts h ON h.id = hf.handout_id WHERE h.campaign_id = $1)`,
    ids: ['id'],
    users: ['owner_id'],
  },
  {
    name: 'handouts',
    where: 'campaign_id = $1',
    ids: ['id'],
    refs: ['campaign_id'],
    users: ['created_by'],
  },
  {
    name: 'handout_recipients',
    where: IN_CAMPAIGN_HANDOUTS,
    refs: ['handout_id'],
    users: ['user_id'],
  },
  { name: 'handout_files', where: IN_CAMPAIGN_HANDOUTS, refs: ['handout_id', 'media_id'] },
  {
    name: 'loot_items',
    where: 'campaign_id = $1',
    ids: ['id'],
    refs: ['campaign_id'],
    users: ['dropped_by', 'claimed_by'],
  },
  {
    name: 'scheduled_sessions',
    where: 'campaign_id = $1',
    ids: ['id'],
    refs: ['campaign_id'],
    users: ['created_by'],
  },
  { name: 'session_rsvps', where: IN_CAMPAIGN_SESSIONS, refs: ['session_id'], users: ['user_id'] },
  { name: 'session_reminders', where: IN_CAMPAIGN_SESSIONS, refs: ['session_id'] },
  { name: 'recordings', where: 'campaign_id = $1', ids: ['id'], refs: ['campaign_id'] },
  {
    name: 'recording_tracks',
    where: IN_CAMPAIGN_RECORDINGS,
    ids: ['id'],
    refs: ['recording_id'],
    userText: ['speaker_id'],
  },
  {
    name: 'recording_events',
    where: IN_CAMPAIGN_RECORDINGS,
    order: 'id',
    refs: ['recording_id'],
    drop: ['id'],
  },
  {
    name: 'transcript_segments',
    where: `track_id IN (SELECT t.id FROM recording_tracks t JOIN recordings r ON r.id = t.recording_id WHERE r.campaign_id = $1)`,
    order: 'track_id, seq',
    refs: ['track_id'],
  },
  { name: 'summaries', where: IN_CAMPAIGN_RECORDINGS, ids: ['id'], refs: ['recording_id'] },
];

/** Tables that hang off a campaign or its recordings and are deliberately left out, and why. */
export const NOT_EXPORTED: Record<string, string> = {
  invites: 'a code is a secret, and the DM makes a new one',
  join_requests: 'short-lived',
  notifications: 'short-lived',
  jobs: 'the worker queue',
};

type Row = Record<string, unknown>;

export interface ArchiveUser {
  id: string;
  email: string;
  displayName: string;
}

export interface CampaignArchive {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  exportedAt: number;
  /** The newest migration the exporting server had applied; an older server cannot import it. */
  schema: string;
  campaign: { id: string; name: string };
  users: ArchiveUser[];
  tables: Record<string, Row[]>;
  /** Handout pictures and PDFs, by media id. */
  media: { id: string; data: string }[];
}

/** A recording with nothing to export yet: its text does not exist, so exporting now would lose it. */
export interface UnprocessedRecording {
  id: string;
  startedAt: number;
  status: string;
}

export class ArchiveError extends Error {}

export async function unprocessedRecordings(
  pool: pg.Pool,
  campaignId: string,
): Promise<UnprocessedRecording[]> {
  const { rows } = await pool.query<{ id: string; started_at: string; status: string }>(
    `SELECT id, started_at, status FROM recordings
      WHERE campaign_id = $1 AND status <> 'processed' ORDER BY started_at`,
    [campaignId],
  );
  return rows.map((r) => ({ id: r.id, startedAt: Number(r.started_at), status: r.status }));
}

export interface ExportOptions {
  /** Where handout files are read from; without it a campaign with handout files cannot be exported. */
  media?: MediaStorage;
  now?: () => number;
}

export async function exportCampaign(
  pool: pg.Pool,
  campaignId: string,
  options: ExportOptions = {},
): Promise<{ archive: CampaignArchive; missingMedia: string[] }> {
  const client = await pool.connect();
  try {
    // One snapshot, so the tables agree with each other while people are playing.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: found } = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM campaigns WHERE id = $1',
      [campaignId],
    );
    const campaign = found[0];
    if (!campaign) throw new ArchiveError('no campaign with that id');
    const { rows: last } = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1',
    );

    const tables: Record<string, Row[]> = {};
    for (const spec of TABLES) {
      const { rows } = await client.query<{ r: Row }>(
        `SELECT to_jsonb(t) AS r FROM ${spec.name} t WHERE ${spec.where}${spec.order ? ` ORDER BY ${spec.order}` : ''}`,
        [campaignId],
      );
      tables[spec.name] = rows.map((x) => x.r);
    }

    const userIds = new Set<string>();
    for (const spec of TABLES) {
      for (const row of tables[spec.name] ?? []) {
        for (const col of spec.users ?? []) {
          if (typeof row[col] === 'string') userIds.add(row[col]);
        }
        for (const col of spec.userText ?? []) {
          if (typeof row[col] === 'string' && UUID.test(row[col])) userIds.add(row[col]);
        }
      }
    }
    const { rows: people } = await client.query<{
      id: string;
      email: string;
      display_name: string;
    }>('SELECT id, email, display_name FROM users WHERE id = ANY($1::uuid[]) ORDER BY created_at', [
      [...userIds],
    ]);
    await client.query('COMMIT');

    const media: CampaignArchive['media'] = [];
    const missingMedia: string[] = [];
    const files = tables.media_files ?? [];
    if (files.length > 0 && !options.media) {
      throw new ArchiveError(
        'this campaign has handout files and MEDIA_DIR is not set here, so they cannot be read',
      );
    }
    for (const file of files) {
      const id = String(file.id);
      const bytes = await options.media?.get(id);
      if (bytes) media.push({ id, data: bytes.toString('base64') });
      else missingMedia.push(id);
    }

    return {
      archive: {
        format: ARCHIVE_FORMAT,
        version: ARCHIVE_VERSION,
        exportedAt: (options.now ?? Date.now)(),
        schema: last[0]?.name ?? '',
        campaign,
        users: people.map((p) => ({ id: p.id, email: p.email, displayName: p.display_name })),
        tables,
        media,
      },
      missingMedia,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const packArchive = (archive: CampaignArchive): Buffer =>
  gzipSync(Buffer.from(JSON.stringify(archive)));

export function unpackArchive(bytes: Buffer): CampaignArchive {
  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(bytes).toString('utf8'));
  } catch {
    throw new ArchiveError('that is not a campaign export file (could not read it)');
  }
  const a = parsed as Partial<CampaignArchive> | null;
  if (!a || a.format !== ARCHIVE_FORMAT || !a.tables || !a.campaign || !Array.isArray(a.users)) {
    throw new ArchiveError('that is not a campaign export file');
  }
  if (typeof a.version !== 'number' || a.version > ARCHIVE_VERSION) {
    throw new ArchiveError(
      'that file was made by a newer version of the server; upgrade this server first',
    );
  }
  return a as CampaignArchive;
}

export interface ImportOptions {
  media?: MediaStorage;
  /** Import as a new campaign with fresh ids even if the original is not on this server. */
  asNew?: boolean;
  now?: () => number;
}

export interface ImportResult {
  campaignId: string;
  name: string;
  /** Members whose email matched an account here. */
  matched: number;
  /** Members with no account here: placeholders were made; they sign in by emailed link or single sign-on. */
  created: ArchiveUser[];
  recordings: number;
  files: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Replaces every mapped id inside a JSON value (a recording event's detail, a loot split, a sheet). */
function remapJson(value: unknown, map: Map<string, string>): unknown {
  if (map.size === 0) return value;
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remapJson(v, map));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [map.get(k) ?? k, remapJson(v, map)]),
    );
  }
  return value;
}

export async function importCampaign(
  pool: pg.Pool,
  archive: CampaignArchive,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const now = (options.now ?? Date.now)();
  const client = await pool.connect();
  const written: string[] = [];
  try {
    const { rows: last } = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1',
    );
    if (archive.schema > (last[0]?.name ?? '')) {
      throw new ArchiveError(
        `that file comes from a newer server (schema ${archive.schema}); upgrade this server first`,
      );
    }
    const files = archive.media ?? [];
    if (files.length > 0 && !options.media) {
      throw new ArchiveError(
        'the export holds handout files and MEDIA_DIR is not set here, so they cannot be stored',
      );
    }

    await client.query('BEGIN');
    const { rows: taken } = await client.query('SELECT 1 FROM campaigns WHERE id = $1', [
      archive.campaign.id,
    ]);
    if (taken.length > 0 && !options.asNew) {
      throw new ArchiveError(
        'a campaign with that id is already on this server; delete it first, or import with --as-new to make a copy',
      );
    }

    // New ids for everything the campaign owns when making a copy; otherwise the same ids, so a restored
    // recording finds its audio again in the server backup.
    const ids = new Map<string, string>();
    if (options.asNew) {
      for (const spec of TABLES) {
        for (const row of archive.tables[spec.name] ?? []) {
          for (const col of spec.ids ?? []) {
            const old = row[col];
            if (typeof old === 'string' && !ids.has(old)) ids.set(old, randomUUID());
          }
        }
      }
    }
    // Media files shared with another campaign keep their id and are not written twice.
    const existingMedia = new Set<string>();
    if (!options.asNew) {
      const { rows } = await client.query<{ id: string }>(
        'SELECT id FROM media_files WHERE id = ANY($1::uuid[])',
        [(archive.tables.media_files ?? []).map((r) => r.id)],
      );
      for (const r of rows) existingMedia.add(r.id);
    }

    // People: matched by email; anyone missing gets a placeholder account with no password.
    const users = new Map<string, string>();
    const created: ArchiveUser[] = [];
    let matched = 0;
    for (const person of archive.users) {
      const email = person.email.toLowerCase();
      const { rows } = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
        email,
      ]);
      if (rows[0]) {
        users.set(person.id, rows[0].id);
        matched += 1;
        continue;
      }
      const { rows: idTaken } = await client.query('SELECT 1 FROM users WHERE id = $1', [
        person.id,
      ]);
      const id = idTaken.length > 0 ? randomUUID() : person.id;
      await client.query(
        `INSERT INTO users (id, email, display_name, password_hash, is_admin, consent_version, consent_at, created_at)
         VALUES ($1, $2, $3, NULL, FALSE, '', 0, $4)`,
        [id, email, person.displayName, now],
      );
      users.set(person.id, id);
      created.push(person);
    }

    const everything = new Map<string, string>([...ids, ...users]);
    for (const spec of TABLES) {
      const rows = archive.tables[spec.name] ?? [];
      for (const raw of rows) {
        if (spec.name === 'media_files' && existingMedia.has(String(raw.id))) continue;
        const row: Row = { ...raw };
        for (const col of spec.drop ?? []) delete row[col];
        for (const col of [...(spec.ids ?? []), ...(spec.refs ?? [])]) {
          if (typeof row[col] === 'string') row[col] = ids.get(row[col]) ?? row[col];
        }
        for (const col of spec.users ?? []) {
          if (typeof row[col] === 'string') row[col] = users.get(row[col]) ?? row[col];
        }
        for (const col of spec.userText ?? []) {
          if (typeof row[col] === 'string') row[col] = users.get(row[col]) ?? row[col];
        }
        for (const [col, value] of Object.entries(row)) {
          if (value && typeof value === 'object') row[col] = remapJson(value, everything);
        }
        if (spec.name === 'campaigns' && options.asNew && taken.length > 0) {
          row.name = `${String(row.name)} (copy)`;
        }
        if (
          spec.name === 'recordings' &&
          (row.status === 'recording' || row.status === 'processing')
        ) {
          // It was cut off by the export: nothing is running for it here.
          row.status = 'failed';
        }
        if (spec.name === 'recording_tracks' && options.asNew) {
          // A copy has no audio of its own to point at.
          row.purged_at ??= now;
        }
        const cols = Object.keys(row);
        await client.query(
          `INSERT INTO ${spec.name} (${cols.join(', ')})
           SELECT ${cols.join(', ')} FROM jsonb_populate_record(NULL::${spec.name}, $1::jsonb)`,
          [JSON.stringify(row)],
        );
      }
    }

    // Files last, so a failure above leaves nothing on disk; a failure here rolls the database back and the
    // files already written are removed (anything missed is swept as unused).
    for (const file of files) {
      const id = ids.get(file.id) ?? file.id;
      // A row already here (shared with another campaign, or left behind) keeps its file if the file is there.
      if (existingMedia.has(id) && (await options.media!.get(id))) continue;
      await options.media!.put(id, Buffer.from(file.data, 'base64'));
      written.push(id);
    }
    await client.query('COMMIT');

    return {
      campaignId: ids.get(archive.campaign.id) ?? archive.campaign.id,
      name: archive.campaign.name,
      matched,
      created,
      recordings: (archive.tables.recordings ?? []).length,
      files: written.length,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    for (const id of written) await options.media?.delete(id).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
