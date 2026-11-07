import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { openTestDb, TEST_DATABASE_URL, type TestDb } from '../testing.js';
import { PostgresJobQueue } from './postgresQueue.js';
import { MemoryJobQueue, type JobQueue } from './queue.js';

/** Behaviour every JobQueue must share. */
function queueContract(name: string, make: () => Promise<JobQueue>): void {
  describe(`JobQueue contract: ${name}`, () => {
    let q: JobQueue;
    beforeEach(async () => {
      q = await make();
    });

    it('does not add a second job for the same kind while one is queued or running', async () => {
      const a = await q.enqueue({ kind: 'k' }, 1000);
      const b = await q.enqueue({ kind: 'k' }, 1001);
      expect(b.id).toBe(a.id);
      await q.claim(1002, 60_000);
      expect((await q.enqueue({ kind: 'k' }, 1003)).id).toBe(a.id);
      await q.complete(a.id, 1004);
      expect((await q.enqueue({ kind: 'k' }, 1005)).id).not.toBe(a.id);
    });

    it('claims the oldest due job, counts the attempt and takes a lease', async () => {
      const first = await q.enqueue({ kind: 'a' }, 1000);
      await q.enqueue({ kind: 'b' }, 1001);
      const claimed = await q.claim(2000, 60_000);
      expect(claimed).toMatchObject({
        id: first.id,
        state: 'running',
        attempts: 1,
        lockedUntil: 62_000,
      });
    });

    it('returns nothing when nothing is due, and never hands one job to two claimers', async () => {
      expect(await q.claim(1000, 1000)).toBeUndefined();
      await q.enqueue({ kind: 'a' }, 1000);
      const [x, y] = await Promise.all([q.claim(2000, 60_000), q.claim(2000, 60_000)]);
      expect([x, y].filter(Boolean)).toHaveLength(1);
    });

    it('retries a failed job after its backoff, not before', async () => {
      const job = await q.enqueue({ kind: 'a' }, 1000);
      await q.claim(1000, 60_000);
      const after = await q.fail(job.id, 'boom', 2000, 10_000);
      expect(after).toMatchObject({ state: 'queued', lastError: 'boom', runAfter: 10_000 });
      expect(await q.claim(5000, 60_000)).toBeUndefined();
      expect((await q.claim(10_000, 60_000))?.attempts).toBe(2);
    });

    it('fails for good when the attempts are used up', async () => {
      const job = await q.enqueue({ kind: 'a', maxAttempts: 2 }, 1000);
      await q.claim(1000, 60_000);
      await q.fail(job.id, 'one', 1100, 1200);
      await q.claim(1200, 60_000);
      const last = await q.fail(job.id, 'two', 1300, 1400);
      expect(last).toMatchObject({ state: 'failed', attempts: 2, lastError: 'two' });
      expect(await q.claim(99_999, 60_000)).toBeUndefined();
    });

    it('lets an operator put a failed job back with fresh attempts', async () => {
      const job = await q.enqueue({ kind: 'a', maxAttempts: 1 }, 1000);
      await q.claim(1000, 60_000);
      await q.fail(job.id, 'x', 1100, 1200);
      expect((await q.get(job.id))?.state).toBe('failed');
      expect(await q.retry(job.id, 2000)).toMatchObject({
        state: 'queued',
        attempts: 0,
        lastError: null,
      });
      expect(await q.retry(job.id, 2001)).toBeUndefined(); // only failed jobs can be retried
    });

    it('re-offers a running job whose worker died (lease expired)', async () => {
      const job = await q.enqueue({ kind: 'a' }, 1000);
      await q.claim(1000, 1000);
      expect(await q.claim(1500, 1000)).toBeUndefined(); // lease still held
      const again = await q.claim(2500, 1000);
      expect(again).toMatchObject({ id: job.id, attempts: 2 });
    });

    it('a heartbeat keeps the lease', async () => {
      const job = await q.enqueue({ kind: 'a' }, 1000);
      await q.claim(1000, 1000);
      await q.extendLease(job.id, 1800, 1000);
      expect(await q.claim(2500, 1000)).toBeUndefined();
    });

    it('gives up on a job that keeps killing its worker', async () => {
      const job = await q.enqueue({ kind: 'a', maxAttempts: 2 }, 1000);
      await q.claim(1000, 100);
      await q.claim(2000, 100);
      expect(await q.claim(3000, 100)).toBeUndefined();
      expect(await q.get(job.id)).toMatchObject({ state: 'failed', attempts: 2 });
    });

    it('lists by state', async () => {
      const a = await q.enqueue({ kind: 'a' }, 1000);
      await q.enqueue({ kind: 'b' }, 1001);
      await q.claim(1002, 1000);
      expect((await q.list(['running'])).map((j) => j.id)).toEqual([a.id]);
      expect(await q.list()).toHaveLength(2);
    });
  });
}

queueContract('memory', async () => new MemoryJobQueue());

if (TEST_DATABASE_URL !== undefined) {
  const db: TestDb = await openTestDb();
  afterAll(() => db.close());
  queueContract('postgres', async () => {
    await db.reset();
    return new PostgresJobQueue(db.pool);
  });
}
