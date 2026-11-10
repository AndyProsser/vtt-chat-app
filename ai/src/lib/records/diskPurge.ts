import { statfs } from 'node:fs/promises';

import type { Recording } from '../../types/index.js';
import type { JobQueue } from '../jobs/queue.js';
import { PURGE_RECORDING_JOB } from './purgeRecording.js';
import type { RecordsStore } from './recordsStore.js';

const DAY_MS = 86_400_000;

/** How long a DM has between the warning and the deletion. */
export const AUDIO_NOTICE_DAYS = 3;

/** A processed recording whose audio is still on disk, with when its DM was warned (if at all). */
export type PurgeCandidate = Recording & { audioNoticeAt?: number | null };

export interface DiskPurgePlan {
  /** Warn these recordings' DMs that their audio will be deleted soon. */
  notify: PurgeCandidate[];
  /** Delete the audio of these now. */
  purge: PurgeCandidate[];
}

/**
 * What to do about a disk that is filling up with raw audio (decided with Andy, 2026-11-10): below
 * `lowPercent` free, the oldest recordings' DMs are warned and the audio goes once the warning is
 * `noticeDays` old; below `criticalPercent` free the wait is skipped. Each sweep touches at most
 * `maxPerSweep` recordings of each kind, oldest first (the caller passes them oldest first), because
 * deleting is slow to take effect and a single run must not clear a whole library. Pure: the caller
 * measures the disk, asks the store and does the work.
 */
export function planDiskPurges(input: {
  freePercent: number;
  candidates: PurgeCandidate[];
  now: number;
  lowPercent?: number;
  criticalPercent?: number;
  noticeDays?: number;
  maxPerSweep?: number;
}): DiskPurgePlan {
  const low = input.lowPercent ?? 10;
  const critical = input.criticalPercent ?? 3;
  const noticeMs = (input.noticeDays ?? AUDIO_NOTICE_DAYS) * DAY_MS;
  const max = input.maxPerSweep ?? 2;
  const none: DiskPurgePlan = { notify: [], purge: [] };
  if (!(input.freePercent < low)) return none;

  if (input.freePercent < critical) return { notify: [], purge: input.candidates.slice(0, max) };

  const purge: PurgeCandidate[] = [];
  const notify: PurgeCandidate[] = [];
  for (const r of input.candidates) {
    const warnedAt = r.audioNoticeAt ?? null;
    if (warnedAt === null) {
      if (notify.length < max) notify.push(r);
    } else if (input.now - warnedAt >= noticeMs && purge.length < max) {
      purge.push(r);
    }
  }
  return { notify, purge };
}

/** Percent of the disk holding `dir` that is free, or `undefined` if it cannot be measured. */
export async function freePercentOf(dir: string): Promise<number | undefined> {
  try {
    const s = await statfs(dir);
    const total = s.blocks * s.bsize;
    return total > 0 ? ((s.bavail * s.bsize) / total) * 100 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One pass of the disk rule: measure, plan, then warn and queue purges. Returns what it did. The purge
 * itself is the worker's ordinary `purge-recording` job, so it only ever touches processed recordings.
 */
export async function sweepDiskPurges(deps: {
  records: RecordsStore;
  queue: JobQueue;
  freePercent: number;
  now?: () => number;
  noticeDays?: number;
}): Promise<{ notified: number; purged: number }> {
  const now = (deps.now ?? Date.now)();
  const noticeMs = (deps.noticeDays ?? AUDIO_NOTICE_DAYS) * DAY_MS;
  // Oldest first; everything processed that still has audio.
  const candidates = await deps.records.listPurgeableRecordings(now + 1, 200);
  const plan = planDiskPurges({
    freePercent: deps.freePercent,
    candidates,
    now,
    ...(deps.noticeDays === undefined ? {} : { noticeDays: deps.noticeDays }),
  });
  for (const r of plan.notify) {
    await deps.records.markAudioNotice(r.id, now);
    await deps.records.notifyAudioPurgeSoon(r.id, now + noticeMs, now);
  }
  for (const r of plan.purge) {
    await deps.queue.enqueue({ kind: PURGE_RECORDING_JOB, recordingId: r.id }, now);
  }
  return { notified: plan.notify.length, purged: plan.purge.length };
}
