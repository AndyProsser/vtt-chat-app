import path from 'node:path';

import type { Job } from '../../types/index.js';
import type { JobQueue } from '../jobs/queue.js';
import type { JobHandler } from '../jobs/worker.js';
import type { RecordsStore } from './recordsStore.js';

export const PURGE_RECORDING_JOB = 'purge-recording';

const DAY_MS = 86_400_000;

/** Whether `file` is a file inside `dir` (never `dir` itself, never a path that climbs out of it). */
export function insideDirectory(dir: string, file: string): boolean {
  const relative = path.relative(path.resolve(dir), path.resolve(file));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export interface PurgeDeps {
  records: RecordsStore;
  /** Deletes one file; `false` if it was already gone. Throws for a path outside the recordings folder. */
  deleteFile: (filePath: string) => Promise<boolean>;
  now?: () => number;
  log?: (line: string) => void;
}

/**
 * Deletes the raw audio of a **processed** recording and notes it, keeping the transcript and the
 * summaries (the text is the record; the audio is what fills the disk). Run it again and nothing
 * changes. A recording that has not been processed is refused: its audio is still the input.
 */
export function createPurgeRecordingHandler(deps: PurgeDeps): JobHandler {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  return {
    run: async (job: Job) => {
      if (!job.recordingId) throw new Error('purge-recording job has no recording');
      const recording = await deps.records.getRecording(job.recordingId);
      if (!recording) return; // deleted since: nothing left to purge
      if (recording.status !== 'processed') {
        throw new Error(
          `recording ${recording.id} is not processed yet, so its audio is still needed`,
        );
      }
      let removed = 0;
      for (const track of await deps.records.listTracks(recording.id)) {
        if ((track.purgedAt ?? null) !== null) continue;
        if (await deps.deleteFile(track.filePath)) removed += 1;
        await deps.records.markTrackPurged(track.id, now());
      }
      log(`${recording.id}: purged the raw audio (${removed} file(s))`);
    },
  };
}

/**
 * Queues a purge for every processed recording that stopped more than `days` ago and still has audio.
 * `days` of 0 (or less) means keep audio for ever. Returns how many it asked for; the queue ignores a
 * second request for a recording that already has one waiting.
 */
export async function scheduleRetentionPurges(deps: {
  records: RecordsStore;
  queue: JobQueue;
  now?: () => number;
  days: number;
  limit?: number;
}): Promise<number> {
  if (!(deps.days > 0)) return 0;
  const now = deps.now ?? Date.now;
  const due = await deps.records.listPurgeableRecordings(
    now() - deps.days * DAY_MS,
    deps.limit ?? 50,
  );
  for (const recording of due) {
    await deps.queue.enqueue({ kind: PURGE_RECORDING_JOB, recordingId: recording.id }, now());
  }
  return due.length;
}
