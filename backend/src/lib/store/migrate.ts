import { readdir, readFile } from 'node:fs/promises';

import type pg from 'pg';

/** `backend/migrations/`, resolved from both `src/lib/store/` and `dist/lib/store/`. */
export const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);

/**
 * Applies every `NNNN_name.sql` in `migrations/` that hasn't run yet, in filename order, each in its
 * own transaction. Returns the names it applied. A migration is never edited once released — add a
 * new file instead. An advisory lock keeps two backends starting at once from racing.
 */
export async function migrate(pool: pg.Pool, dir: URL = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(new URL(file, dir), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
      applied.push(file);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
    client.release();
  }
  return applied;
}
