import type { Job } from '../../types/index.js';
import type { JobQueue } from './queue.js';

export interface JobHandler {
  run: (job: Job) => Promise<void>;
  /** Called once when the job has failed for good (attempts exhausted), e.g. to mark a recording failed. */
  onGiveUp?: (job: Job, error: string) => Promise<void>;
}

export interface WorkerOptions {
  queue: JobQueue;
  handlers: Record<string, JobHandler>;
  /** A running job must heartbeat inside this window or another worker may take it. */
  leaseMs?: number;
  /** Idle wait when the queue is empty. */
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  log?: (line: string) => void;
}

/** 15 s, 30 s, 1 min … capped at 10 min: long enough for a restarting Whisper box to come back. */
export function retryDelayMs(attempt: number): number {
  return Math.min(10 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

const realSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Claims and runs at most one job. Returns false when the queue had nothing due. Exposed
 * separately from {@link runWorker} so tests and a "run once" CLI mode can drive it.
 */
export async function processNext(options: WorkerOptions): Promise<boolean> {
  const { queue } = options;
  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const log = options.log ?? (() => undefined);

  const job = await queue.claim(now(), leaseMs);
  if (!job) return false;
  const handler = options.handlers[job.kind];
  if (!handler) {
    await queue.fail(
      job.id,
      `no handler for job kind "${job.kind}"`,
      now(),
      now() + retryDelayMs(job.attempts),
    );
    return true;
  }

  log(`job ${job.id} (${job.kind}) attempt ${job.attempts}/${job.maxAttempts}`);
  // Heartbeat so a long transcription is not mistaken for a dead worker.
  const heartbeat = setInterval(
    () => {
      queue.extendLease(job.id, now(), leaseMs).catch(() => undefined);
    },
    Math.max(1000, Math.floor(leaseMs / 3)),
  );
  try {
    await handler.run(job);
    await queue.complete(job.id, now());
    log(`job ${job.id} done`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const after = await queue.fail(job.id, message, now(), now() + retryDelayMs(job.attempts));
    if (after.state === 'failed') {
      log(`job ${job.id} FAILED for good: ${message}`);
      await handler.onGiveUp?.(after, message).catch(() => undefined);
    } else {
      log(
        `job ${job.id} failed (${message}); retrying in ${Math.round((after.runAfter - now()) / 1000)} s`,
      );
    }
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

/** Runs until `signal` aborts. Finishes the job in hand first, so a restart never abandons work mid-write. */
export async function runWorker(options: WorkerOptions): Promise<void> {
  const sleep = options.sleep ?? realSleep;
  while (!options.signal?.aborted) {
    const worked = await processNext(options);
    if (!worked) await sleep(options.pollMs ?? 5000, options.signal);
  }
}
