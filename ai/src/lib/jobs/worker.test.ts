import { describe, expect, it, vi } from 'vitest';

import { MemoryJobQueue } from './queue.js';
import { processNext, retryDelayMs, runWorker } from './worker.js';

describe('retryDelayMs', () => {
  it('backs off exponentially and caps at ten minutes', () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([15_000, 30_000, 60_000]);
    expect(retryDelayMs(30)).toBe(600_000);
  });
});

describe('processNext', () => {
  it('runs a job and marks it done', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.enqueue({ kind: 'k' }, 0);
    const run = vi.fn(async () => undefined);
    expect(await processNext({ queue, handlers: { k: { run } }, now: () => 1 })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect((await queue.get(job.id))?.state).toBe('done');
  });

  it('reports an empty queue', async () => {
    expect(await processNext({ queue: new MemoryJobQueue(), handlers: {} })).toBe(false);
  });

  it('queues a failed job for retry with backoff and records the error', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.enqueue({ kind: 'k' }, 0);
    await processNext({
      queue,
      handlers: { k: { run: async () => Promise.reject(new Error('whisper down')) } },
      now: () => 1000,
    });
    expect(await queue.get(job.id)).toMatchObject({
      state: 'queued',
      lastError: 'whisper down',
      runAfter: 1000 + 15_000,
    });
  });

  it('calls onGiveUp exactly once when attempts run out', async () => {
    const queue = new MemoryJobQueue();
    await queue.enqueue({ kind: 'k', maxAttempts: 1 }, 0);
    const onGiveUp = vi.fn(async () => undefined);
    await processNext({
      queue,
      handlers: { k: { run: async () => Promise.reject(new Error('nope')), onGiveUp } },
      now: () => 1,
    });
    expect(onGiveUp).toHaveBeenCalledOnce();
  });

  it('fails a job of an unknown kind instead of looping on it', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.enqueue({ kind: 'mystery', maxAttempts: 1 }, 0);
    await processNext({ queue, handlers: {}, now: () => 1 });
    expect(await queue.get(job.id)).toMatchObject({ state: 'failed' });
  });
});

describe('runWorker', () => {
  it('drains the queue, sleeps when idle and stops when aborted', async () => {
    const queue = new MemoryJobQueue();
    await queue.enqueue({ kind: 'a' }, 0);
    const ac = new AbortController();
    const ran: string[] = [];
    let sleeps = 0;
    await runWorker({
      queue,
      handlers: { a: { run: async (j) => void ran.push(j.kind) } },
      signal: ac.signal,
      now: () => 1,
      sleep: async () => {
        sleeps += 1;
        ac.abort();
      },
    });
    expect(ran).toEqual(['a']);
    expect(sleeps).toBe(1);
  });
});
