import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import pg from 'pg';

import { createPool } from './records/postgresRecordsStore.js';

/**
 * Point at a scratch Postgres to run the queue and store suites against the real thing:
 *
 *   TEST_DATABASE_URL=postgres://postgres:scratch@127.0.0.1:55432/vtt npm test -w @vtt-chat-app/ai
 *
 * Unset, those suites run against the in-memory implementations.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const MIGRATIONS = new URL('../../../backend/migrations/', import.meta.url);

export interface TestDb {
  pool: pg.Pool;
  /** Inserts a campaign (recordings reference one) and returns its id. */
  campaign: (name?: string) => Promise<string>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

/** A throwaway schema with every backend migration applied, so test files can run in parallel. */
export async function openTestDb(): Promise<TestDb> {
  if (TEST_DATABASE_URL === undefined) throw new Error('TEST_DATABASE_URL is not set');
  const schema = `t_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = createPool(TEST_DATABASE_URL, { options: `-c search_path=${schema}` });
  for (const file of (await readdir(MIGRATIONS)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
    await pool.query(await readFile(new URL(file, MIGRATIONS), 'utf8'));
  }
  return {
    pool,
    campaign: async (name = 'Test campaign') => {
      const id = randomUUID();
      await pool.query('INSERT INTO campaigns (id, name, created_at) VALUES ($1, $2, 1)', [
        id,
        name,
      ]);
      return id;
    },
    reset: async () => {
      await pool.query(
        'TRUNCATE jobs, summaries, transcript_segments, recording_tracks, recordings, campaigns CASCADE',
      );
    },
    close: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
