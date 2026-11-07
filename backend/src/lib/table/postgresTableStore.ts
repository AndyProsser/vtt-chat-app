import type pg from 'pg';

import type { MediaKind } from '../media/mediaStorage.js';
import type {
  Handout,
  HandoutKind,
  HandoutVisibility,
  MediaFile,
  TableStore,
  Viewer,
} from './tableStore.js';

type Row = Record<string, unknown>;

/** Postgres' "invalid input syntax for type uuid": an id that was never issued can match nothing. */
const BAD_UUID = '22P02';

const toMedia = (r: Row): MediaFile => ({
  id: r.id as string,
  ownerId: (r.owner_id as string | null) ?? null,
  kind: r.kind as MediaKind,
  mime: r.mime as string,
  bytes: r.bytes as number,
  sha256: r.sha256 as string,
  originalName: r.original_name as string,
  createdAt: r.created_at as number,
});

const toHandout = (r: Row): Handout => ({
  id: r.id as string,
  campaignId: r.campaign_id as string,
  title: r.title as string,
  kind: r.kind as HandoutKind,
  body: (r.body as string | null) ?? null,
  mediaId: (r.media_id as string | null) ?? null,
  visibility: r.visibility as HandoutVisibility,
  recipients: (r.recipients as string[] | null) ?? [],
  createdBy: (r.created_by as string | null) ?? null,
  createdAt: r.created_at as number,
});

const HANDOUT_SELECT = `
  SELECT h.*, COALESCE(array_agg(r.user_id::text) FILTER (WHERE r.user_id IS NOT NULL), '{}') AS recipients
    FROM handouts h LEFT JOIN handout_recipients r ON r.handout_id = h.id`;

/** The table-feature tables of `backend/migrations/`. */
export class PostgresTableStore implements TableStore {
  constructor(private readonly pool: pg.Pool) {}

  async putMedia(f: MediaFile): Promise<void> {
    await this.pool.query(
      `INSERT INTO media_files (id, owner_id, kind, mime, bytes, sha256, original_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [f.id, f.ownerId, f.kind, f.mime, f.bytes, f.sha256, f.originalName, f.createdAt],
    );
  }

  async getMedia(id: string): Promise<MediaFile | undefined> {
    try {
      const { rows } = await this.pool.query<Row>('SELECT * FROM media_files WHERE id = $1', [id]);
      return rows[0] ? toMedia(rows[0]) : undefined;
    } catch (error) {
      if ((error as { code?: string }).code === BAD_UUID) return undefined;
      throw error;
    }
  }

  async deleteMedia(id: string): Promise<void> {
    await this.pool.query('DELETE FROM media_files WHERE id = $1', [id]);
  }

  async campaignHandoutBytes(campaignId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string | null }>(
      `SELECT COALESCE(SUM(m.bytes), 0)::bigint AS n FROM handouts h
         JOIN media_files m ON m.id = h.media_id WHERE h.campaign_id = $1`,
      [campaignId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async putHandout(h: Handout): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO handouts (id, campaign_id, title, kind, body, media_id, visibility, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET title = $3, kind = $4, body = $5, media_id = $6, visibility = $7`,
        [
          h.id,
          h.campaignId,
          h.title,
          h.kind,
          h.body,
          h.mediaId,
          h.visibility,
          h.createdBy,
          h.createdAt,
        ],
      );
      await client.query('DELETE FROM handout_recipients WHERE handout_id = $1', [h.id]);
      for (const userId of h.recipients) {
        await client.query('INSERT INTO handout_recipients (handout_id, user_id) VALUES ($1, $2)', [
          h.id,
          userId,
        ]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getHandout(id: string): Promise<Handout | undefined> {
    try {
      const { rows } = await this.pool.query<Row>(
        `${HANDOUT_SELECT} WHERE h.id = $1 GROUP BY h.id`,
        [id],
      );
      return rows[0] ? toHandout(rows[0]) : undefined;
    } catch (error) {
      if ((error as { code?: string }).code === BAD_UUID) return undefined;
      throw error;
    }
  }

  async listHandouts(campaignId: string, viewer: Viewer): Promise<Handout[]> {
    // The visibility rule, in SQL: the DM sees everything; others see "all" or what is shared with them.
    const { rows } = await this.pool.query<Row>(
      `${HANDOUT_SELECT}
        WHERE h.campaign_id = $1
          AND ($3 OR h.visibility = 'all'
               OR (h.visibility = 'some' AND EXISTS (
                     SELECT 1 FROM handout_recipients x WHERE x.handout_id = h.id AND x.user_id = $2)))
        GROUP BY h.id ORDER BY h.created_at, h.id`,
      [campaignId, viewer.userId, viewer.isDm],
    );
    return rows.map(toHandout);
  }

  async deleteHandout(id: string): Promise<void> {
    await this.pool.query('DELETE FROM handouts WHERE id = $1', [id]);
  }
}
