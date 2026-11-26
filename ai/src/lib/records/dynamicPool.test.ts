import { describe, expect, test } from 'vitest';

import { createDynamicPool } from './dynamicPool.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Lets every already-queued microtask run before the next assertion, however many hops deep
 * (a plain `await Promise.resolve()` only flushes a fixed number of hops, which is fragile against
 * an implementation detail like an extra `.catch` in the dispatch loop). A macrotask boundary
 * (`setImmediate`) only runs once every pending microtask has drained, so it is robust to that.
 */
async function tick(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

describe('createDynamicPool', () => {
  test('does not start a new task past the current limit, even as it changes', async () => {
    let limit = 2;
    const pool = createDynamicPool({ currentLimit: async () => limit });
    let running = 0;
    const started = Array.from({ length: 5 }, () => deferred());
    const tasks = started.map((d) =>
      pool.run(async () => {
        running++;
        try {
          await d.promise;
        } finally {
          running--;
        }
      }),
    );
    await tick(); // let the first wave start
    expect(running).toBe(2); // two in flight under the original limit — not 1 (ignoring it entirely
    // would also leave exactly one task running at this point, so this alone wouldn't catch a
    // broken pool; the next assertion is the one that actually tells them apart)
    limit = 1;
    started[0]!.resolve();
    await tick();
    expect(running).toBe(1); // a slot freed, but the new limit holds the next dispatch to 1 — a
    // pool that ignored the change would read 2 here (the freed slot immediately refilled)
    started.slice(1).forEach((d) => d.resolve());
    await Promise.all(tasks);
  });

  test('awaits the gate before every task, not just the first', async () => {
    const gateCalls: number[] = [];
    const pool = createDynamicPool({
      currentLimit: async () => 2,
      gate: async () => {
        gateCalls.push(Date.now());
      },
    });
    await Promise.all([pool.run(async () => {}), pool.run(async () => {})]);
    expect(gateCalls).toHaveLength(2);
  });

  test('treats a currentLimit failure as limit 1 instead of rejecting unhandled', async () => {
    let fail = true;
    const pool = createDynamicPool({
      currentLimit: async () => {
        if (fail) throw new Error('settings unreachable');
        return 3;
      },
    });
    const first = await pool.run(async () => 'a');
    expect(first).toBe('a');
    fail = false;
    const second = await pool.run(async () => 'b');
    expect(second).toBe('b');
  });

  test('clamps a nonsensical limit (0, negative, NaN) to at least 1 instead of deadlocking or running unbounded', async () => {
    let limit: number = 0;
    const pool = createDynamicPool({ currentLimit: async () => limit });
    let running = 0;
    let maxRunning = 0;
    const run = () =>
      pool.run(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      });
    await run(); // limit 0 must still make progress (clamped to 1), not hang forever
    limit = -2;
    await run(); // a negative limit must not be treated as "unbounded"
    limit = Number.NaN;
    await Promise.all([run(), run(), run()]);
    expect(maxRunning).toBe(1);
  });

  test('serialises every task when the limit is fixed at 1, overlap included', async () => {
    const pool = createDynamicPool({ currentLimit: async () => 1 });
    const order: number[] = [];
    let running = 0;
    let maxRunning = 0;
    await Promise.all(
      [1, 2, 3].map((n) =>
        pool.run(async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          order.push(n);
          await new Promise((r) => setTimeout(r, 5));
          running--;
        }),
      ),
    );
    expect(maxRunning).toBe(1); // proves no overlap — FIFO start order alone (below) does not:
    // an unbounded pool would start all three in the same order too, just concurrently
    expect(order).toEqual([1, 2, 3]);
  });
});
