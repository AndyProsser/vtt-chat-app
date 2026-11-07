import type pg from 'pg';

import type { Board, Scene, Sound, SoundCategory, SoundStore, Take } from './soundStore.js';

type Row = Record<string, unknown>;
const BAD_UUID = '22P02';

async function guard<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    // An id that was never issued matches nothing (and must not become a server error).
    if ((error as { code?: string }).code === BAD_UUID) return fallback;
    throw error;
  }
}

const toTake = (r: Row): Take => ({
  id: r.id as string,
  soundId: r.sound_id as string,
  mediaId: r.media_id as string,
  level: Number(r.level),
  position: r.position as number,
});

const toSound = (r: Row, takes: Take[]): Sound => ({
  id: r.id as string,
  ownerId: r.owner_id as string,
  name: r.name as string,
  category: r.category as SoundCategory,
  tags: (r.tags as string[]) ?? [],
  takes,
  createdAt: r.created_at as number,
});

export class PostgresSoundStore implements SoundStore {
  constructor(private readonly pool: pg.Pool) {}

  private async takesFor(soundIds: string[]): Promise<Map<string, Take[]>> {
    const out = new Map<string, Take[]>(soundIds.map((id) => [id, []]));
    if (soundIds.length === 0) return out;
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM sound_takes WHERE sound_id = ANY($1::uuid[]) ORDER BY position, id',
      [soundIds],
    );
    for (const r of rows) out.get(r.sound_id as string)?.push(toTake(r));
    return out;
  }

  async putSound(s: Sound): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO sounds (id, owner_id, name, category, tags, created_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET name = $3, category = $4, tags = $5`,
        [s.id, s.ownerId, s.name, s.category, s.tags, s.createdAt],
      );
      await client.query('DELETE FROM sound_takes WHERE sound_id = $1', [s.id]);
      for (const t of s.takes) {
        await client.query(
          'INSERT INTO sound_takes (id, sound_id, media_id, level, position) VALUES ($1, $2, $3, $4, $5)',
          [t.id, s.id, t.mediaId, t.level, t.position],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  getSound = (id: string) =>
    guard(async () => {
      const { rows } = await this.pool.query<Row>('SELECT * FROM sounds WHERE id = $1', [id]);
      const r = rows[0];
      return r ? toSound(r, (await this.takesFor([id])).get(id) ?? []) : undefined;
    }, undefined);

  async listSounds(ownerId: string): Promise<Sound[]> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM sounds WHERE owner_id = $1 ORDER BY created_at, id',
      [ownerId],
    );
    const takes = await this.takesFor(rows.map((r) => r.id as string));
    return rows.map((r) => toSound(r, takes.get(r.id as string) ?? []));
  }

  async deleteSound(id: string): Promise<void> {
    await this.pool.query('DELETE FROM sounds WHERE id = $1', [id]);
  }

  getTake = (takeId: string) =>
    guard(async () => {
      const { rows } = await this.pool.query<Row>('SELECT * FROM sound_takes WHERE id = $1', [
        takeId,
      ]);
      if (!rows[0]) return undefined;
      const take = toTake(rows[0]);
      const sound = await this.getSound(take.soundId);
      return sound ? { take, sound } : undefined;
    }, undefined);

  async putBoard(b: Board): Promise<void> {
    await this.pool.query(
      `INSERT INTO soundboards (id, owner_id, name, buttons, created_at) VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (id) DO UPDATE SET name = $3, buttons = $4::jsonb`,
      [b.id, b.ownerId, b.name, JSON.stringify(b.buttons), b.createdAt],
    );
  }
  getBoard = (id: string) =>
    guard(async () => {
      const { rows } = await this.pool.query<Row>('SELECT * FROM soundboards WHERE id = $1', [id]);
      return rows[0] ? this.toBoard(rows[0]) : undefined;
    }, undefined);
  async listBoards(ownerId: string): Promise<Board[]> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM soundboards WHERE owner_id = $1 ORDER BY created_at, id',
      [ownerId],
    );
    return rows.map((r) => this.toBoard(r));
  }
  async deleteBoard(id: string): Promise<void> {
    await this.pool.query('DELETE FROM soundboards WHERE id = $1', [id]);
  }
  private toBoard(r: Row): Board {
    return {
      id: r.id as string,
      ownerId: r.owner_id as string,
      name: r.name as string,
      buttons: r.buttons as Board['buttons'],
      createdAt: r.created_at as number,
    };
  }

  async putScene(s: Scene): Promise<void> {
    await this.pool.query(
      `INSERT INTO scenes (id, owner_id, name, layers, created_at) VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (id) DO UPDATE SET name = $3, layers = $4::jsonb`,
      [s.id, s.ownerId, s.name, JSON.stringify(s.layers), s.createdAt],
    );
  }
  getScene = (id: string) =>
    guard(async () => {
      const { rows } = await this.pool.query<Row>('SELECT * FROM scenes WHERE id = $1', [id]);
      return rows[0] ? this.toScene(rows[0]) : undefined;
    }, undefined);
  async listScenes(ownerId: string): Promise<Scene[]> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM scenes WHERE owner_id = $1 ORDER BY created_at, id',
      [ownerId],
    );
    return rows.map((r) => this.toScene(r));
  }
  async deleteScene(id: string): Promise<void> {
    await this.pool.query('DELETE FROM scenes WHERE id = $1', [id]);
  }
  private toScene(r: Row): Scene {
    return {
      id: r.id as string,
      ownerId: r.owner_id as string,
      name: r.name as string,
      layers: r.layers as Scene['layers'],
      createdAt: r.created_at as number,
    };
  }
}
