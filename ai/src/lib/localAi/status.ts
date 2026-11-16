import type { Pool } from 'pg';

import type { LocalAiStatus, LocalModelState, LocalModelStatus } from '../../types/localAi.js';

/** A download whose status has not been refreshed for this long has stalled (the worker refreshes it every 15 s). */
export const DOWNLOAD_STALLED_MS = 5 * 60_000;

export async function writeLocalAiStatus(pool: Pool, status: LocalAiStatus): Promise<void> {
  await pool.query('UPDATE instance_settings SET local_ai = $1 WHERE id = 1', [
    JSON.stringify(status),
  ]);
}

/** Null when no worker has reported (no records pipeline, or an older worker). */
export async function readLocalAiStatus(pool: Pool): Promise<LocalAiStatus | null> {
  const { rows } = await pool.query<{ local_ai: unknown }>(
    'SELECT local_ai FROM instance_settings WHERE id = 1',
  );
  const value = rows[0]?.local_ai as Partial<LocalAiStatus> | null | undefined;
  if (!value || typeof value.at !== 'number') return null;
  return { at: value.at, llm: value.llm ?? null, whisper: value.whisper ?? null };
}

export interface LocalAiReporter {
  llm(status: LocalModelStatus): void;
  whisper(status: LocalModelStatus): void;
}

export interface ReporterOptions {
  write: (status: LocalAiStatus) => Promise<void>;
  now?: () => number;
  /** A failed write (the database is restarting, or not migrated yet on a first start) is tried again after this. */
  retryMs?: number;
}

/**
 * Collects the two halves of the status and saves the whole on every change. Never throws and never blocks the
 * caller: reporting is a courtesy to the operator, and must not be able to stop a job.
 */
export function createLocalAiReporter(options: ReporterOptions): LocalAiReporter {
  const now = options.now ?? Date.now;
  const current: LocalAiStatus = { at: now(), llm: null, whisper: null };
  let writing = false;
  let dirty = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const flush = (): void => {
    if (writing) return;
    clearTimeout(retry);
    writing = true;
    dirty = false;
    options
      .write({ ...current })
      .then(
        () => undefined,
        () => {
          dirty = true;
        },
      )
      .finally(() => {
        writing = false;
        if (!dirty) return;
        retry = setTimeout(flush, options.retryMs ?? 30_000);
        retry.unref();
      });
  };
  const set = (key: 'llm' | 'whisper', status: LocalModelStatus): void => {
    current[key] = status;
    current.at = now();
    if (writing) dirty = true;
    else flush();
  };
  return { llm: (status) => set('llm', status), whisper: (status) => set('whisper', status) };
}

/** A model's state as shown to people: the stored state, or `stalled` for a download that stopped reporting. */
export type ShownModelState = LocalModelState | 'stalled';

export function shownState(
  model: LocalModelStatus | null,
  reportedAt: number,
  now: number,
): ShownModelState | null {
  if (!model) return null;
  if (model.state === 'downloading' && now - reportedAt > DOWNLOAD_STALLED_MS) return 'stalled';
  return model.state;
}

/** True when a state needs the operator: a download failed or stalled. Waiting and downloading are normal. */
export const needsAttention = (state: ShownModelState | null): boolean =>
  state === 'failed' || state === 'stalled';

/** One line for `vtt-admin status`, e.g. "summary model downloading (43%), Whisper ready". */
export function describeLocalAi(status: LocalAiStatus, now: number): string {
  const part = (name: string, model: LocalModelStatus | null): string | undefined => {
    const state = shownState(model, status.at, now);
    if (!model || !state) return undefined;
    switch (state) {
      case 'ready':
        return `${name} ready`;
      case 'downloading':
        return `${name} downloading (${model.percent ?? 0}%)`;
      case 'stalled':
        return `${name} download has stalled at ${model.percent ?? 0}%`;
      case 'failed':
        return `${name} download failed${model.detail ? `: ${model.detail}` : ''}`;
      case 'waiting':
        return `${name} not answering${model.detail ? ` (${model.detail})` : ''}`;
    }
  };
  const parts = [part('summary model', status.llm), part('Whisper', status.whisper)].filter(
    (p) => p !== undefined,
  );
  return parts.length > 0 ? parts.join(', ') : 'nothing reported';
}
