// This version runs ONE worker per database (Andy, 2026-11-21). The queue could hand jobs to several, and keeps a table's
// sessions in order (queue.ts), but the model servers are tuned for one job at a time and nothing has been measured with
// more, so a second worker would only compete for them. The worker therefore takes a Postgres advisory lock for as long as
// it runs; a second one stands by until the first stops (a rolling restart, a crash) instead of working alongside it.
// `ALLOW_MULTIPLE_WORKERS=1` skips the check, for an operator who has the hardware and has read ROADMAP Stage 17.

import type pg from 'pg';

/** An arbitrary application-wide key for the advisory lock ("VTT" worker). */
export const WORKER_LOCK_KEY = 7_117_001;

export interface WorkerLock {
  held: boolean;
  release(): Promise<void>;
}

/** Tries once to become the only worker. The connection that holds the lock is kept until `release`. */
export async function tryBecomeOnlyWorker(pool: pg.Pool): Promise<WorkerLock> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [
      WORKER_LOCK_KEY,
    ]);
    if (rows[0]?.ok === true) {
      return {
        held: true,
        release: async () => {
          try {
            await client.query('SELECT pg_advisory_unlock($1)', [WORKER_LOCK_KEY]);
          } finally {
            client.release();
          }
        },
      };
    }
  } catch (error) {
    client.release();
    throw error;
  }
  client.release();
  return { held: false, release: async () => {} };
}

/**
 * Waits until this worker is the only one. Returns its lock, or undefined if `signal` aborted first. Logs once when it
 * has to stand by, and again when it takes over.
 */
export async function waitToBeOnlyWorker(
  pool: pg.Pool,
  options: {
    signal?: AbortSignal;
    pollMs?: number;
    log: (line: string) => void;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  },
): Promise<WorkerLock | undefined> {
  const sleep =
    options.sleep ??
    ((ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          resolve();
        });
      }));
  let announced = false;
  while (!options.signal?.aborted) {
    const lock = await tryBecomeOnlyWorker(pool);
    if (lock.held) {
      if (announced) options.log('the other worker has stopped: this one takes over');
      return lock;
    }
    if (!announced) {
      options.log(
        'another worker is already running on this database. This version runs one worker at a time, so this one stands by and takes over if the other stops (set ALLOW_MULTIPLE_WORKERS=1 to run several at your own risk; see ROADMAP Stage 17)',
      );
      announced = true;
    }
    await sleep(options.pollMs ?? 30_000, options.signal);
  }
  return undefined;
}
