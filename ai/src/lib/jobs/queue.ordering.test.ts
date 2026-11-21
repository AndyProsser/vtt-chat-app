import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { openTestDb, TEST_DATABASE_URL, type TestDb } from '../testing.js';
import { PostgresJobQueue } from './postgresQueue.js';
import { MemoryJobQueue, type JobQueue } from './queue.js';

const KIND = 'process-recording';

interface Harness {
  q: JobQueue;
  campaign: () => Promise<string>;
  /** A recording in a campaign that started at `startedAt`; returns its id. */
  recording: (campaignId: string, startedAt: number) => Promise<string>;
}

/** One table's sessions are processed in the order they were recorded. Shared by the memory and Postgres queues. */
function orderingContract(name: string, make: () => Promise<Harness>): void {
  describe(`one table's sessions are processed in order: ${name}`, () => {
    let h: Harness;
    beforeEach(async () => {
      h = await make();
    });

    async function two() {
      const c = await h.campaign();
      const r1 = await h.recording(c, 1000);
      const r2 = await h.recording(c, 2000);
      // The later session's job is queued first on purpose: order is by when the session was recorded.
      const j2 = await h.q.enqueue({ kind: KIND, recordingId: r2 }, 3000);
      const j1 = await h.q.enqueue({ kind: KIND, recordingId: r1 }, 3001);
      return { c, r1, r2, j1, j2 };
    }

    it('does not start a later session while the earlier one is queued, and starts it once that is done', async () => {
      const { j1, j2 } = await two();
      expect((await h.q.claim(4000, 60_000))?.id).toBe(j1.id);
      // j1 is running: j2 must wait, however long.
      expect(await h.q.claim(9_000_000, 60_000)).toBeUndefined();
      expect((await h.q.blockedBy(j2.id))?.id).toBe(j1.id);
      await h.q.complete(j1.id, 5000);
      expect((await h.q.claim(5001, 60_000))?.id).toBe(j2.id);
      expect(await h.q.blockedBy(j2.id)).toBeUndefined();
    });

    it('holds the later session while the earlier job waits to retry (the case a plain queue gets wrong)', async () => {
      const { j1, j2 } = await two();
      await h.q.claim(4000, 60_000); // j1
      await h.q.fail(j1.id, 'boom', 4500, 100_000); // back to queued, due at 100 000
      expect(await h.q.claim(5000, 60_000)).toBeUndefined();
      expect((await h.q.claim(100_000, 60_000))?.id).toBe(j1.id);
      void j2;
    });

    it('holds the later session behind a job that failed for good, until it is retried or released', async () => {
      const { j1, j2 } = await two();
      await h.q.claim(4000, 60_000);
      await h.q.fail(j1.id, 'boom', 4500, 4500); // attempts left: queued
      for (let i = 0; i < 5; i += 1) {
        const again = await h.q.claim(5000 + i, 60_000);
        if (again) await h.q.fail(again.id, 'boom', 5000 + i, 5000 + i);
      }
      expect(await h.q.get(j1.id)).toMatchObject({ state: 'failed' });
      expect(await h.q.claim(10_000, 60_000)).toBeUndefined();
      expect((await h.q.blockedBy(j2.id))?.state).toBe('failed');
      // The operator releases it: the later session goes ahead.
      expect((await h.q.release(j1.id))?.released).toBe(true);
      expect((await h.q.claim(10_001, 60_000))?.id).toBe(j2.id);
    });

    it('a retried job is held to the order again, and release only applies to a failed job', async () => {
      const { j1, j2 } = await two();
      expect(await h.q.release(j1.id)).toBeUndefined(); // queued, not failed
      await h.q.claim(4000, 60_000);
      await h.q.fail(j1.id, 'x', 4001, 4001);
      for (let i = 0; i < 5; i += 1) {
        const again = await h.q.claim(5000 + i, 60_000);
        if (again) await h.q.fail(again.id, 'x', 5000 + i, 5000 + i);
      }
      await h.q.release(j1.id);
      const retried = await h.q.retry(j1.id, 20_000);
      expect(retried?.released).toBeFalsy();
      expect((await h.q.claim(20_001, 60_000))?.id).toBe(j1.id);
      expect(await h.q.claim(20_002, 60_000)).toBeUndefined();
      void j2;
    });

    it('never holds back the earliest session (reprocessing it), another table, or another kind of job', async () => {
      const c1 = await h.campaign();
      const c2 = await h.campaign();
      const a1 = await h.recording(c1, 1000);
      const a2 = await h.recording(c1, 2000);
      const b1 = await h.recording(c2, 1500);
      const ja2 = await h.q.enqueue({ kind: KIND, recordingId: a2 }, 3000);
      const jb1 = await h.q.enqueue({ kind: KIND, recordingId: b1 }, 3001);
      const purge = await h.q.enqueue({ kind: 'purge-recording', recordingId: a2 }, 3002);
      // Table 1's session 2 has no earlier job, so it is not held; run everything and check nothing was stuck.
      const claimed = [] as string[];
      for (let i = 0; i < 3; i += 1) {
        const j = await h.q.claim(4000 + i, 60_000);
        if (j) claimed.push(j.id);
      }
      expect(new Set(claimed)).toEqual(new Set([ja2.id, jb1.id, purge.id]));
      // Session 1 is reprocessed after session 2 is done: it is the earliest, so it runs.
      for (const id of claimed) await h.q.complete(id, 5000);
      const again = await h.q.enqueue({ kind: KIND, recordingId: a1 }, 6000);
      expect((await h.q.claim(6001, 60_000))?.id).toBe(again.id);
    });
  });
}

orderingContract('memory', async () => {
  const sessions = new Map<string, { campaignId: string; startedAt: number }>();
  const q = new MemoryJobQueue(randomUUID, (id) => sessions.get(id));
  return {
    q,
    campaign: async () => randomUUID(),
    recording: async (campaignId, startedAt) => {
      const id = randomUUID();
      sessions.set(id, { campaignId, startedAt });
      return id;
    },
  };
});

if (TEST_DATABASE_URL !== undefined) {
  const db: TestDb = await openTestDb();
  afterAll(() => db.close());
  orderingContract('postgres', async () => {
    await db.reset();
    return {
      q: new PostgresJobQueue(db.pool),
      campaign: () => db.campaign(),
      recording: async (campaignId, startedAt) => {
        const id = randomUUID();
        await db.pool.query(
          `INSERT INTO recordings (id, campaign_id, started_at, status) VALUES ($1, $2, $3, 'stopped')`,
          [id, campaignId, startedAt],
        );
        return id;
      },
    };
  });
}
