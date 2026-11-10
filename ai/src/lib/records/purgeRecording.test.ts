import { beforeEach, describe, expect, it } from 'vitest';

import type { Job, Recording, RecordingTrack } from '../../types/index.js';
import { MemoryJobQueue } from '../jobs/queue.js';
import { MemoryRecordsStore } from './memoryRecordsStore.js';
import {
  createPurgeRecordingHandler,
  insideDirectory,
  PURGE_RECORDING_JOB,
  scheduleRetentionPurges,
} from './purgeRecording.js';

const DAY = 86_400_000;
const NOW = 100 * DAY;

const recording = (id: string, over: Partial<Recording> = {}): Recording => ({
  id,
  campaignId: 'camp',
  startedAt: 0,
  stoppedAt: 10 * DAY,
  status: 'processed',
  ...over,
});
const track = (id: string, recordingId: string, over: Partial<RecordingTrack> = {}) => ({
  id,
  recordingId,
  speakerId: 'a',
  speakerName: 'A',
  filePath: `/out/${recordingId}/${id}.ogg`,
  startOffsetMs: 0,
  private: false,
  transcribedAt: 5,
  ...over,
});
const job = (recordingId: string): Job => ({
  id: 'j',
  kind: PURGE_RECORDING_JOB,
  recordingId,
  state: 'running',
  attempts: 1,
  maxAttempts: 3,
  runAfter: 0,
  lockedUntil: null,
  lastError: null,
  createdAt: 0,
  updatedAt: 0,
});

let records: MemoryRecordsStore;
let deleted: string[];
const handler = (missing = new Set<string>()) =>
  createPurgeRecordingHandler({
    records,
    deleteFile: async (path) => {
      if (missing.has(path)) return false;
      deleted.push(path);
      return true;
    },
    now: () => NOW,
  });

beforeEach(async () => {
  records = new MemoryRecordsStore();
  deleted = [];
  await records.putRecording(recording('r1'));
  await records.putTrack(track('t1', 'r1'));
  await records.putTrack(track('t2', 'r1'));
  await records.saveTrackTranscript('t1', [{ startMs: 0, endMs: 1, text: 'hello' }], 5);
});

describe('purging the raw audio of a recording', () => {
  it('deletes every track file, notes when, and keeps the transcript and summaries', async () => {
    await records.putSummary({
      recordingId: 'r1',
      kind: 'session',
      subject: '',
      visibility: 'members',
      text: 'It happened.',
      modelCalls: 1,
      createdAt: 1,
    });
    await handler().run(job('r1'));
    expect(deleted.sort()).toEqual(['/out/r1/t1.ogg', '/out/r1/t2.ogg']);
    expect((await records.listTracks('r1')).every((t) => t.purgedAt === NOW)).toBe(true);
    expect((await records.listTranscripts('r1'))[0]?.segments).toHaveLength(1);
    expect(await records.getSummary('r1', 'session', '')).toBeDefined();
  });

  it('refuses a recording that has not been processed yet: the audio is still needed', async () => {
    await records.setRecordingStatus('r1', 'stopped');
    await expect(handler().run(job('r1'))).rejects.toThrow(/not processed/);
    expect(deleted).toEqual([]);
  });

  it('is safe to run twice and does not mind a file that is already gone', async () => {
    await handler(new Set(['/out/r1/t2.ogg'])).run(job('r1'));
    await handler().run(job('r1'));
    expect(deleted).toEqual(['/out/r1/t1.ogg']);
    expect((await records.listTracks('r1')).every((t) => t.purgedAt === NOW)).toBe(true);
  });
});

describe('the retention sweep', () => {
  it('queues a purge for processed recordings older than the retention and nothing else', async () => {
    await records.setRecordingStatus('r1', 'stopped'); // not part of this test
    await records.putRecording(recording('old', { stoppedAt: NOW - 40 * DAY }));
    await records.putTrack(track('o1', 'old'));
    await records.putRecording(recording('recent', { stoppedAt: NOW - 5 * DAY }));
    await records.putTrack(track('n1', 'recent'));
    await records.putRecording(
      recording('waiting', { stoppedAt: NOW - 40 * DAY, status: 'stopped' }),
    );
    await records.putTrack(track('w1', 'waiting'));
    await records.putRecording(recording('done', { stoppedAt: NOW - 40 * DAY }));
    await records.putTrack(track('d1', 'done', { purgedAt: 1 }));
    const queue = new MemoryJobQueue();
    const queued = await scheduleRetentionPurges({ records, queue, now: () => NOW, days: 30 });
    expect(queued).toBe(1);
    expect((await queue.list(['queued'])).map((j) => [j.kind, j.recordingId])).toEqual([
      [PURGE_RECORDING_JOB, 'old'],
    ]);
    // Asking again does not pile up a second job.
    await scheduleRetentionPurges({ records, queue, now: () => NOW, days: 30 });
    expect(await queue.list(['queued'])).toHaveLength(1);
  });

  it('does nothing when the retention is off', async () => {
    const queue = new MemoryJobQueue();
    expect(await scheduleRetentionPurges({ records, queue, now: () => NOW, days: 0 })).toBe(0);
    expect(await queue.list()).toHaveLength(0);
  });
});

describe('insideDirectory', () => {
  it('allows only files under the recordings folder', () => {
    expect(insideDirectory('/out', '/out/r1/a.ogg')).toBe(true);
    expect(insideDirectory('/out/', '/out/r1/a.ogg')).toBe(true);
    expect(insideDirectory('/out', '/out/../etc/passwd')).toBe(false);
    expect(insideDirectory('/out', '/outside/a.ogg')).toBe(false);
    expect(insideDirectory('/out', '/out')).toBe(false);
  });
});
