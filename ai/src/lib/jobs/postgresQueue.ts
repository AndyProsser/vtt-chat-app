import type pg from 'pg';

import type { Job } from '../../types/index.js';
import type { EnqueueInput, JobQueue } from './queue.js';

type Row = Record<string, unknown>;

const toJob = (r: Row): Job => ({
  id: r.id as string,
  kind: r.kind as string,
  recordingId: (r.recording_id as string | null) ?? null,
  state: r.state as Job['state'],
  attempts: r.attempts as number,
  maxAttempts: r.max_attempts as number,
  runAfter: r.run_after as number,
  lockedUntil: (r.locked_until as number | null) ?? null,
  lockedBy: (r.locked_by as string | null) ?? null,
  lastError: (r.last_error as string | null) ?? null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
});

/** The `jobs` table of `backend/migrations/0003_records.sql`. Safe to run from several workers. */
export class PostgresJobQueue implements JobQueue {
  constructor(private readonly pool: pg.Pool) {}

  async enqueue(input: EnqueueInput, now: number): Promise<Job> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialise enqueues for one recording so the duplicate check below cannot race.
      if (input.recordingId) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.recordingId]);
      }
      const existing = await client.query<Row>(
        `SELECT * FROM jobs WHERE kind = $1 AND recording_id IS NOT DISTINCT FROM $2
           AND state IN ('queued', 'running') LIMIT 1`,
        [input.kind, input.recordingId ?? null],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return toJob(existing.rows[0]);
      }
      const { rows } = await client.query<Row>(
        `INSERT INTO jobs (id, kind, recording_id, max_attempts, run_after, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $4, $4) RETURNING *`,
        [input.kind, input.recordingId ?? null, input.maxAttempts ?? 5, now],
      );
      await client.query('COMMIT');
      return toJob(rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claim(now: number, leaseMs: number, workerId?: string): Promise<Job | undefined> {
    // A running job is orphaned when its lease ran out, or when this same worker id holds it (the worker
    // restarted). `IS NOT NULL` keeps an anonymous claimer from matching a NULL locked_by.
    const orphaned = (id: string): string =>
      `state = 'running' AND (locked_until <= $1 OR (${id}::text IS NOT NULL AND locked_by = ${id}::text))`;
    await this.pool.query(
      `UPDATE jobs SET state = 'failed', locked_until = NULL, locked_by = NULL, updated_at = $1,
         last_error = COALESCE(last_error, 'worker stopped responding on the final attempt')
       WHERE ${orphaned('$2')} AND attempts >= max_attempts`,
      [now, workerId ?? null],
    );
    const { rows } = await this.pool.query<Row>(
      `UPDATE jobs SET state = 'running', attempts = attempts + 1, locked_until = $1 + $2::bigint, locked_by = $3::text, updated_at = $1
       WHERE id = (
         SELECT id FROM jobs
         WHERE (state = 'queued' AND run_after <= $1) OR (${orphaned('$3')})
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
       RETURNING *`,
      [now, leaseMs, workerId ?? null],
    );
    return rows[0] ? toJob(rows[0]) : undefined;
  }

  async extendLease(id: string, now: number, leaseMs: number): Promise<void> {
    await this.pool.query(
      `UPDATE jobs SET locked_until = $2 + $3::bigint, updated_at = $2 WHERE id = $1 AND state = 'running'`,
      [id, now, leaseMs],
    );
  }

  async complete(id: string, now: number): Promise<void> {
    await this.pool.query(
      `UPDATE jobs SET state = 'done', locked_until = NULL, locked_by = NULL, last_error = NULL, updated_at = $2 WHERE id = $1`,
      [id, now],
    );
  }

  async fail(id: string, error: string, now: number, retryAt: number): Promise<Job> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE jobs SET last_error = $2, locked_until = NULL, locked_by = NULL, updated_at = $3,
         state = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
         run_after = CASE WHEN attempts >= max_attempts THEN run_after ELSE $4 END
       WHERE id = $1 RETURNING *`,
      [id, error.slice(0, 2000), now, retryAt],
    );
    if (!rows[0]) throw new Error(`no job ${id}`);
    return toJob(rows[0]);
  }

  async retry(id: string, now: number): Promise<Job | undefined> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE jobs SET state = 'queued', attempts = 0, run_after = $2, last_error = NULL, updated_at = $2
       WHERE id = $1 AND state = 'failed' RETURNING *`,
      [id, now],
    );
    return rows[0] ? toJob(rows[0]) : undefined;
  }

  async get(id: string): Promise<Job | undefined> {
    try {
      const { rows } = await this.pool.query<Row>('SELECT * FROM jobs WHERE id = $1', [id]);
      return rows[0] ? toJob(rows[0]) : undefined;
    } catch (error) {
      if ((error as { code?: string }).code === '22P02') return undefined; // not a UUID
      throw error;
    }
  }

  async list(states?: Job['state'][]): Promise<Job[]> {
    const { rows } = await this.pool.query<Row>(
      states
        ? 'SELECT * FROM jobs WHERE state = ANY($1) ORDER BY created_at, id'
        : 'SELECT * FROM jobs ORDER BY created_at, id',
      states ? [states] : [],
    );
    return rows.map(toJob);
  }
}
