import { describe, expect, test } from 'vitest';

import { createDynamicPool } from './dynamicPool.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Lets already-queued microtasks (promise callbacks) run before the next assertion. */
async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('createDynamicPool', () => {
  test('does not start a new task past the current limit, even as it changes', async () => {
    let limit = 2;
    const pool = createDynamicPool({ currentLimit: async () => limit });
    let running = 0;
    let maxRunning = 0;
    const started = Array.from({ length: 5 }, () => deferred());
    const tasks = started.map((d) =>
      pool.run(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await d.promise;
        running--;
      }),
    );
    await tick(); // let the first wave start
    expect(maxRunning).toBe(2);
    limit = 1;
    started[0]!.resolve();
    await tick();
    expect(maxRunning).toBe(2); // a slot freed, but the new limit holds the next dispatch to 1
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

  test('serialises every task when the limit is fixed at 1', async () => {
    const pool = createDynamicPool({ currentLimit: async () => 1 });
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        pool.run(async () => {
          order.push(n);
          await new Promise((r) => setTimeout(r, 5));
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });
});
