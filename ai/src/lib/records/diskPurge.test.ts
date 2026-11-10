import { describe, expect, it } from 'vitest';

import type { Recording } from '../../types/index.js';
import { MemoryJobQueue } from '../jobs/queue.js';
import { MemoryRecordsStore } from './memoryRecordsStore.js';
import { planDiskPurges, sweepDiskPurges } from './diskPurge.js';

const DAY = 86_400_000;
const NOW = 100 * DAY;

const rec = (
  id: string,
  audioNoticeAt: number | null = null,
): Recording & { audioNoticeAt: number | null } => ({
  id,
  campaignId: 'c',
  startedAt: 0,
  stoppedAt: 1,
  status: 'processed',
  audioNoticeAt,
});

const plan = (freePercent: number, candidates: ReturnType<typeof rec>[], extra = {}) =>
  planDiskPurges({ freePercent, candidates, now: NOW, ...extra });

describe('planDiskPurges', () => {
  it('does nothing while there is room', () => {
    expect(plan(10, [rec('a'), rec('b')])).toEqual({ notify: [], purge: [] });
    expect(plan(55, [rec('a')])).toEqual({ notify: [], purge: [] });
  });

  it('warns the DM of the oldest recordings first, and purges nothing the same day', () => {
    const out = plan(8, [rec('a'), rec('b'), rec('c')]);
    expect(out.notify.map((r) => r.id)).toEqual(['a', 'b']);
    expect(out.purge).toEqual([]);
  });

  it('purges a recording once its warning is three days old, and not before', () => {
    expect(plan(8, [rec('a', NOW - 3 * DAY + 1)]).purge).toEqual([]);
    expect(plan(8, [rec('a', NOW - 3 * DAY)]).purge.map((r) => r.id)).toEqual(['a']);
  });

  it('does not warn again about a recording that has been warned about', () => {
    expect(plan(8, [rec('a', NOW - DAY)]).notify).toEqual([]);
  });

  it('skips the wait when the disk is nearly full, for the oldest recordings only', () => {
    const out = plan(2, [rec('a'), rec('b'), rec('c')]);
    expect(out.purge.map((r) => r.id)).toEqual(['a', 'b']);
    expect(out.notify.map((r) => r.id)).toEqual([]);
  });

  it('keeps each sweep small, so one run cannot clear a whole library', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => rec(id, NOW - 9 * DAY));
    expect(plan(8, many).purge.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('can be turned to different thresholds', () => {
    expect(plan(15, [rec('a')], { lowPercent: 20 }).notify.map((r) => r.id)).toEqual(['a']);
    expect(plan(8, [rec('a', NOW - DAY)], { noticeDays: 1 }).purge.map((r) => r.id)).toEqual(['a']);
  });
});

describe('sweepDiskPurges', () => {
  async function setup() {
    const records = new MemoryRecordsStore();
    const queue = new MemoryJobQueue();
    for (const [id, stoppedAt] of [
      ['old', 1],
      ['newer', 2],
    ] as const) {
      await records.putRecording({
        id,
        campaignId: 'c',
        startedAt: 0,
        stoppedAt,
        status: 'processed',
      });
      await records.putTrack({
        id: `t-${id}`,
        recordingId: id,
        speakerId: 's',
        speakerName: 'S',
        filePath: `/r/${id}.ogg`,
        startOffsetMs: 0,
        private: false,
        transcribedAt: 1,
      });
    }
    return { records, queue };
  }

  it('warns first, remembers it, and queues the purge only once the notice is old enough', async () => {
    const { records, queue } = await setup();
    const first = await sweepDiskPurges({ records, queue, freePercent: 7, now: () => NOW });
    expect(first).toEqual({ notified: 2, purged: 0 });
    expect(records.audioPurgeNotices.map((n) => n.recordingId)).toEqual(['old', 'newer']);
    expect(records.audioPurgeNotices[0]?.purgeAt).toBe(NOW + 3 * DAY);
    expect((await records.getRecording('old'))?.audioNoticeAt).toBe(NOW);

    const tooSoon = await sweepDiskPurges({ records, queue, freePercent: 7, now: () => NOW + DAY });
    expect(tooSoon).toEqual({ notified: 0, purged: 0 });

    const later = await sweepDiskPurges({
      records,
      queue,
      freePercent: 7,
      now: () => NOW + 3 * DAY,
    });
    expect(later.purged).toBe(2);
    expect((await queue.list()).map((j) => j.recordingId).sort()).toEqual(['newer', 'old']);
  });

  it('does nothing while there is room, and never touches a recording that is not processed', async () => {
    const { records, queue } = await setup();
    await records.putRecording({
      id: 'busy',
      campaignId: 'c',
      startedAt: 0,
      stoppedAt: 0,
      status: 'processing',
    });
    expect(await sweepDiskPurges({ records, queue, freePercent: 40, now: () => NOW })).toEqual({
      notified: 0,
      purged: 0,
    });
    const out = await sweepDiskPurges({ records, queue, freePercent: 1, now: () => NOW });
    expect(out.purged).toBe(2);
    expect((await queue.list()).some((j) => j.recordingId === 'busy')).toBe(false);
  });
});
