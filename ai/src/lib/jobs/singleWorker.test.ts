import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { tryBecomeOnlyWorker, waitToBeOnlyWorker, WORKER_LOCK_KEY } from './singleWorker.js';

/** A pool whose database grants the advisory lock to one holder at a time, like Postgres does. */
function fakePool() {
  const state = { holder: undefined as symbol | undefined, released: 0, queries: [] as string[] };
  const pool = {
    connect: async () => {
      const me = Symbol('connection');
      return {
        query: async (text: string, values: unknown[]) => {
          state.queries.push(text);
          expect(values).toEqual([WORKER_LOCK_KEY]);
          if (text.includes('pg_try_advisory_lock')) {
            if (state.holder === undefined) {
              state.holder = me;
              return { rows: [{ ok: true }] };
            }
            return { rows: [{ ok: state.holder === me }] };
          }
          if (text.includes('pg_advisory_unlock')) state.holder = undefined;
          return { rows: [] };
        },
        release: () => {
          state.released += 1;
        },
      };
    },
  } as unknown as pg.Pool;
  return { pool, state };
}

describe('one worker per database', () => {
  it('the first worker takes the lock and keeps its connection; a second is refused and gives its connection back', async () => {
    const { pool, state } = fakePool();
    const first = await tryBecomeOnlyWorker(pool);
    expect(first.held).toBe(true);
    expect(state.released).toBe(0);
    const second = await tryBecomeOnlyWorker(pool);
    expect(second.held).toBe(false);
    expect(state.released).toBe(1);
    await first.release();
    expect(state.holder).toBeUndefined();
    expect(state.released).toBe(2);
    expect((await tryBecomeOnlyWorker(pool)).held).toBe(true);
  });

  it('a second worker stands by, says so once, and takes over when the first stops', async () => {
    const { pool } = fakePool();
    const first = await tryBecomeOnlyWorker(pool);
    const lines: string[] = [];
    let polls = 0;
    const lock = await waitToBeOnlyWorker(pool, {
      log: (l) => lines.push(l),
      sleep: async () => {
        polls += 1;
        if (polls === 3) await first.release();
      },
    });
    expect(lock?.held).toBe(true);
    expect(polls).toBe(3);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/one worker at a time.*stands by/);
    expect(lines[1]).toMatch(/takes over/);
  });

  it('stops waiting when it is told to stop', async () => {
    const { pool } = fakePool();
    await tryBecomeOnlyWorker(pool);
    const abort = new AbortController();
    const lock = await waitToBeOnlyWorker(pool, {
      signal: abort.signal,
      log: () => undefined,
      sleep: async () => abort.abort(),
    });
    expect(lock).toBeUndefined();
  });
});
