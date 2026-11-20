import type { GlossaryKind, GlossaryStatus, ItemType, Rarity } from '@vtt-chat-app/shared';
import type pg from 'pg';

import type { MediaKind } from '../media/mediaStorage.js';
import type {
  Handout,
  HandoutKind,
  HandoutVisibility,
  ClaimedFor,
  GlossaryTerm,
  GmNoteFile,
  GmNotes,
  LootItem,
  LootKind,
  LootSplit,
  MediaFile,
  TableStore,
  Viewer,
} from './tableStore.js';

type Row = Record<string, unknown>;

/** Postgres' "invalid input syntax for type uuid": an id that was never issued can match nothing. */
const BAD_UUID = '22P02';

const toGmNoteFile = (r: Row): GmNoteFile => ({
  id: r.id as string,
  campaignId: r.campaign_id as string,
  mediaId: r.media_id as string,
  name: r.name as string,
  createdAt: Number(r.created_at),
});

const toGlossary = (r: Row): GlossaryTerm => ({
  id: r.id as string,
  campaignId: r.campaign_id as string,
  term: r.term as string,
  kind: r.kind as GlossaryKind,
  aliases: r.aliases as string[],
  status: r.status as GlossaryStatus,
  createdAt: Number(r.created_at),
});

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
  mediaIds: (r.media_ids as string[] | null) ?? [],
  visibility: r.visibility as HandoutVisibility,
  recipients: (r.recipients as string[] | null) ?? [],
  createdBy: (r.created_by as string | null) ?? null,
  createdAt: r.created_at as number,
});

const toLoot = (r: Row): LootItem => ({
  id: r.id as string,
  campaignId: r.campaign_id as string,
  kind: r.kind as LootKind,
  itemType: r.item_type as ItemType,
  rarity: (r.rarity as Rarity | null) ?? null,
  srdId: (r.srd_id as string | null) ?? null,
  name: r.name as string,
  description: r.description as string,
  quantity: r.quantity as number,
  droppedBy: (r.dropped_by as string | null) ?? null,
  droppedAt: r.dropped_at as number,
  claimedBy: (r.claimed_by as string | null) ?? null,
  claimedAt: (r.claimed_at as number | null) ?? null,
  claimedFor: (r.claimed_for as ClaimedFor | null) ?? null,
  split: (r.split as LootSplit | null) ?? null,
  confirmed: (r.confirmed as boolean | undefined) ?? false,
});

const HANDOUT_SELECT = `
  SELECT h.*,
         COALESCE(array_agg(DISTINCT r.user_id::text) FILTER (WHERE r.user_id IS NOT NULL), '{}') AS recipients,
         COALESCE((SELECT array_agg(f.media_id::text ORDER BY f.position)
                     FROM handout_files f WHERE f.handout_id = h.id), '{}') AS media_ids
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

  async listUnusedHandoutMedia(olderThan: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT m.id FROM media_files m
        WHERE m.kind IN ('image', 'pdf') AND m.created_at < $1
          AND NOT EXISTS (SELECT 1 FROM handout_files f WHERE f.media_id = m.id)
          AND NOT EXISTS (SELECT 1 FROM gm_note_files g WHERE g.media_id = m.id)`,
      [olderThan],
    );
    return rows.map((r) => r.id);
  }

  async ownerAudioBytes(ownerId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string | null }>(
      "SELECT COALESCE(SUM(bytes), 0)::bigint AS n FROM media_files WHERE owner_id = $1 AND kind = 'audio'",
      [ownerId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async campaignHandoutBytes(campaignId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string | null }>(
      `SELECT (
         (SELECT COALESCE(SUM(m.bytes), 0) FROM handouts h
            JOIN handout_files f ON f.handout_id = h.id
            JOIN media_files m ON m.id = f.media_id WHERE h.campaign_id = $1)
       + (SELECT COALESCE(SUM(m.bytes), 0) FROM gm_note_files g
            JOIN media_files m ON m.id = g.media_id WHERE g.campaign_id = $1)
       )::bigint AS n`,
      [campaignId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async getGmNotes(campaignId: string): Promise<GmNotes | undefined> {
    const { rows } = await this.pool.query('SELECT * FROM gm_notes WHERE campaign_id = $1', [
      campaignId,
    ]);
    const r = rows[0] as Row | undefined;
    return r
      ? {
          campaignId: r.campaign_id as string,
          body: r.body as string,
          updatedAt: Number(r.updated_at),
          updatedBy: (r.updated_by as string | null) ?? null,
        }
      : undefined;
  }

  async putGmNotes(n: GmNotes): Promise<void> {
    await this.pool.query(
      `INSERT INTO gm_notes (campaign_id, body, updated_at, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (campaign_id) DO UPDATE SET body = $2, updated_at = $3, updated_by = $4`,
      [n.campaignId, n.body, n.updatedAt, n.updatedBy],
    );
  }

  async listGmNoteFiles(campaignId: string): Promise<GmNoteFile[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM gm_note_files WHERE campaign_id = $1 ORDER BY created_at, id',
      [campaignId],
    );
    return rows.map(toGmNoteFile);
  }

  async getGmNoteFile(id: string): Promise<GmNoteFile | undefined> {
    try {
      const { rows } = await this.pool.query('SELECT * FROM gm_note_files WHERE id = $1', [id]);
      return rows[0] ? toGmNoteFile(rows[0] as Row) : undefined;
    } catch (error) {
      if ((error as { code?: string }).code === BAD_UUID) return undefined;
      throw error;
    }
  }

  async putGmNoteFile(f: GmNoteFile): Promise<void> {
    await this.pool.query(
      `INSERT INTO gm_note_files (id, campaign_id, media_id, name, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET name = $4`,
      [f.id, f.campaignId, f.mediaId, f.name, f.createdAt],
    );
  }

  async deleteGmNoteFile(id: string): Promise<void> {
    try {
      await this.pool.query('DELETE FROM gm_note_files WHERE id = $1', [id]);
    } catch (error) {
      if ((error as { code?: string }).code !== BAD_UUID) throw error;
    }
  }

  async listGlossary(campaignId: string): Promise<GlossaryTerm[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM glossary_terms WHERE campaign_id = $1 ORDER BY lower(term), id',
      [campaignId],
    );
    return rows.map(toGlossary);
  }

  async getGlossaryTerm(id: string): Promise<GlossaryTerm | undefined> {
    try {
      const { rows } = await this.pool.query('SELECT * FROM glossary_terms WHERE id = $1', [id]);
      return rows[0] ? toGlossary(rows[0] as Row) : undefined;
    } catch (error) {
      if ((error as { code?: string }).code === BAD_UUID) return undefined;
      throw error;
    }
  }

  async putGlossaryTerm(t: GlossaryTerm): Promise<boolean> {
    try {
      await this.pool.query(
        `INSERT INTO glossary_terms (id, campaign_id, term, kind, aliases, status, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (id) DO UPDATE SET term = $3, kind = $4, aliases = $5::jsonb, status = $6`,
        [t.id, t.campaignId, t.term, t.kind, JSON.stringify(t.aliases), t.status, t.createdAt],
      );
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return false; // unique_violation: same spelling
      throw error;
    }
  }

  async deleteGlossaryTerm(id: string): Promise<void> {
    try {
      await this.pool.query('DELETE FROM glossary_terms WHERE id = $1', [id]);
    } catch (error) {
      if ((error as { code?: string }).code !== BAD_UUID) throw error;
    }
  }

  async putHandout(h: Handout): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO handouts (id, campaign_id, title, kind, body, visibility, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET title = $3, kind = $4, body = $5, visibility = $6`,
        [h.id, h.campaignId, h.title, h.kind, h.body, h.visibility, h.createdBy, h.createdAt],
      );
      await client.query('DELETE FROM handout_files WHERE handout_id = $1', [h.id]);
      for (const [position, mediaId] of h.mediaIds.entries()) {
        await client.query(
          'INSERT INTO handout_files (handout_id, position, media_id) VALUES ($1, $2, $3)',
          [h.id, position, mediaId],
        );
      }
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

  async putLoot(i: LootItem): Promise<void> {
    await this.pool.query(
      `INSERT INTO loot_items (id, campaign_id, name, description, quantity, dropped_by, dropped_at, claimed_by, claimed_at, kind, item_type, rarity, srd_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET name = $3, description = $4, quantity = $5`,
      [
        i.id,
        i.campaignId,
        i.name,
        i.description,
        i.quantity,
        i.droppedBy,
        i.droppedAt,
        i.claimedBy,
        i.claimedAt,
        i.kind,
        i.itemType,
        i.rarity,
        i.srdId,
      ],
    );
  }

  async getLoot(id: string): Promise<LootItem | undefined> {
    try {
      const { rows } = await this.pool.query<Row>('SELECT * FROM loot_items WHERE id = $1', [id]);
      return rows[0] ? toLoot(rows[0]) : undefined;
    } catch (error) {
      if ((error as { code?: string }).code === BAD_UUID) return undefined;
      throw error;
    }
  }

  async listLoot(campaignId: string): Promise<LootItem[]> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM loot_items WHERE campaign_id = $1 ORDER BY dropped_at, id',
      [campaignId],
    );
    return rows.map(toLoot);
  }

  async claimLoot(
    id: string,
    userId: string,
    at: number,
    claimedFor: ClaimedFor,
    split?: LootSplit,
  ): Promise<LootItem | undefined> {
    // One conditional UPDATE: of any number of simultaneous claims, the database lets exactly one match.
    try {
      const { rows } = await this.pool.query<Row>(
        `UPDATE loot_items SET claimed_by = $2, claimed_at = $3, claimed_for = $4, split = $5, confirmed = FALSE
          WHERE id = $1 AND claimed_by IS NULL RETURNING *`,
        [id, userId, at, claimedFor, split ? JSON.stringify(split) : null],
      );
      return rows[0] ? toLoot(rows[0]) : undefined;
    } catch (error) {
      if ((error as { code?: string }).code === BAD_UUID) return undefined;
      throw error;
    }
  }

  async changeClaim(
    id: string,
    userId: string,
    from: ClaimedFor[],
    to: 'party' | null,
  ): Promise<LootItem | undefined> {
    try {
      const { rows } = await this.pool.query<Row>(
        to === null
          ? `UPDATE loot_items SET claimed_by = NULL, claimed_at = NULL, claimed_for = NULL, split = NULL, confirmed = FALSE
              WHERE id = $1 AND claimed_by = $2 AND claimed_for = ANY($3) RETURNING *`
          : `UPDATE loot_items SET claimed_for = 'party', confirmed = FALSE
              WHERE id = $1 AND claimed_by = $2 AND claimed_for = ANY($3) RETURNING *`,
        [id, userId, from],
      );
      return rows[0] ? toLoot(rows[0]) : undefined;
    } catch (error) {
      if ((error as { code?: string }).code === BAD_UUID) return undefined;
      throw error;
    }
  }

  async takeFromParty(id: string, userId: string, at: number): Promise<LootItem | undefined> {
    return this.updateOne(
      `UPDATE loot_items SET claimed_by = $2, claimed_at = $3, claimed_for = 'self', confirmed = FALSE
        WHERE id = $1 AND claimed_for = 'party' RETURNING *`,
      [id, userId, at],
    );
  }

  async returnFromParty(id: string): Promise<LootItem | undefined> {
    return this.updateOne(
      `UPDATE loot_items SET claimed_by = NULL, claimed_at = NULL, claimed_for = NULL, split = NULL, confirmed = FALSE
        WHERE id = $1 AND claimed_for = 'party' RETURNING *`,
      [id],
    );
  }

  /** One conditional UPDATE … RETURNING: the row as changed, or `undefined` (no match, or not a UUID). */
  private async updateOne(sql: string, params: unknown[]): Promise<LootItem | undefined> {
    try {
      const { rows } = await this.pool.query<Row>(sql, params);
      return rows[0] ? toLoot(rows[0]) : undefined;
    } catch (error) {
      if ((error as { code?: string }).code === BAD_UUID) return undefined;
      throw error;
    }
  }

  async confirmLoot(id: string, userId: string, confirmed: boolean): Promise<LootItem | undefined> {
    // One conditional UPDATE: the flag lives on the item (own or party) or on the caller's own share of a split.
    return this.updateOne(
      `UPDATE loot_items SET
         confirmed = CASE WHEN claimed_for = 'split' THEN confirmed ELSE $3::boolean END,
         split = CASE WHEN claimed_for = 'split'
           THEN jsonb_set(split, '{shares}', (
                  SELECT jsonb_agg(CASE WHEN s->>'userId' = $2::text THEN s || jsonb_build_object('confirmed', $3::boolean) ELSE s END)
                    FROM jsonb_array_elements(split->'shares') s))
           ELSE split END
        WHERE id = $1 AND claimed_by IS NOT NULL AND (
              (claimed_for IN ('self', 'assigned') AND claimed_by::text = $2::text)
           OR claimed_for = 'party'
           OR (claimed_for = 'split' AND split->'shares' @> jsonb_build_array(jsonb_build_object('userId', $2::text))))
        RETURNING *`,
      [id, userId, confirmed],
    );
  }

  async redropLoot(id: string, at: number): Promise<LootItem | undefined> {
    return this.updateOne(
      'UPDATE loot_items SET dropped_at = $2 WHERE id = $1 AND claimed_by IS NULL RETURNING *',
      [id, at],
    );
  }

  async deleteLoot(id: string): Promise<void> {
    await this.pool.query('DELETE FROM loot_items WHERE id = $1', [id]);
  }
}
