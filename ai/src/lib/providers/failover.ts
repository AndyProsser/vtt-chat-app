import { DEFAULT_FALLBACK_AFTER_MS, DEFAULT_RETRY_INTERVAL_MS } from '../../consts/index.js';
import { ProviderUnavailableError } from './errors.js';

export interface FailoverOptions {
  /** Wait between attempts while the primary is unreachable. */
  retryIntervalMs?: number;
  /**
   * How long the primary may stay unreachable before switching to the fallback. `undefined` means
   * never switch: wait for the primary however long it takes (the "fallback off" setting).
   */
  fallbackAfterMs?: number | undefined;
  /** Stops a wait that would otherwise last forever (job cancelled, shutdown). */
  signal?: AbortSignal;
  /** Injected for tests. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Called once when the job switches to the fallback, so the UI can say so. */
  onFallback?: (reason: string) => void;
}

export interface Failover<I, O> {
  call: (input: I) => Promise<O>;
  /** Which backend the job is on now. Once it has fallen back it stays there for the rest of the job. */
  backend: () => 'primary' | 'fallback';
}

const realSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/**
 * Wraps a remote backend so an unreachable server means "wait, then fall back", never "lose the
 * recording" (CLAUDE.md §5). One instance per job: after the switch every later call in that job
 * uses the fallback, so a transcript is not stitched from two different models partway through, and
 * the next job tries the primary again.
 *
 * Only {@link ProviderUnavailableError} is retried. A 4xx or a malformed reply is a configuration
 * problem and propagates immediately.
 */
export function createFailover<I, O>(
  primary: (input: I) => Promise<O>,
  fallback: ((input: I) => Promise<O>) | undefined,
  options: FailoverOptions = {},
): Failover<I, O> {
  const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const fallbackAfterMs =
    'fallbackAfterMs' in options ? options.fallbackAfterMs : DEFAULT_FALLBACK_AFTER_MS;
  let onFallback = false;
  let unreachableSince: number | undefined;

  const call = async (input: I): Promise<O> => {
    if (onFallback && fallback) return fallback(input);
    for (;;) {
      try {
        const result = await primary(input);
        unreachableSince = undefined;
        return result;
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
        unreachableSince ??= now();
        const waited = now() - unreachableSince;
        if (fallback && fallbackAfterMs !== undefined && waited >= fallbackAfterMs) {
          onFallback = true;
          options.onFallback?.(
            `primary unreachable for ${Math.round(waited / 1000)} s: ${error.message}`,
          );
          return fallback(input);
        }
        // Never sleep past the deadline: a 30 s retry interval must not turn a 2 s timeout into 30 s.
        const untilDeadline =
          fallback && fallbackAfterMs !== undefined ? fallbackAfterMs - waited : Infinity;
        await sleep(Math.max(1, Math.min(retryIntervalMs, untilDeadline)), options.signal);
      }
    }
  };

  return { call, backend: () => (onFallback ? 'fallback' : 'primary') };
}
