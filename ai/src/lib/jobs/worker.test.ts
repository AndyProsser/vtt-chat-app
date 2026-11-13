import { describe, expect, it, vi } from 'vitest';

import { MemoryJobQueue } from './queue.js';
import { processNext, resolveWorkerId, retryDelayMs, runWorker } from './worker.js';

describe('retryDelayMs', () => {
  it('backs off exponentially and caps at ten minutes', () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([15_000, 30_000, 60_000]);
    expect(retryDelayMs(30)).toBe(600_000);
  });
});

describe('resolveWorkerId', () => {
  it('uses WORKER_ID, else the hostname', () => {
    expect(resolveWorkerId({ WORKER_ID: ' worker-1 ' }, 'box')).toBe('worker-1');
    expect(resolveWorkerId({}, 'box')).toBe('box');
    expect(resolveWorkerId({ WORKER_ID: '  ' }, 'box')).toBe('box');
  });
});

describe('processNext', () => {
  it('a restarted worker with the same id takes its interrupted job back at once', async () => {
    const queue = new MemoryJobQueue();
    const job = await queue.enqueue({ kind: 'k' }, 0);
    await queue.claim(0, 300_000, 'worker-1'); // the old process claimed it, then was killed
    const run = vi.fn(async () => undefined);
    const options = { queue, handlers: { k: { run } }, now: () => 10 };
    expect(await processNext({ ...options, workerId: 'worker-2' })).toBe(false); // other id: lease honoured
    expect(await processNext({ ...options, workerId: 'worker-1' })).toBe(true);
    expect((await queue.get(job.id))?.state).toBe('done');
  });

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
