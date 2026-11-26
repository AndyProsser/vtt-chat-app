export interface DynamicPoolOptions {
  /** Re-read before each dispatch; may return a different number each call. */
  currentLimit: () => Promise<number>;
  /** Awaited once a slot is granted, before the task itself runs. Absent = no wait. */
  gate?: () => Promise<void>;
}

export interface DynamicPool {
  /** Runs `task` once a slot is free (per the live `currentLimit`); resolves/rejects with it. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * A FIFO pool whose concurrency limit is read fresh before every dispatch, not fixed at creation —
 * so it can be told to run fewer things at once (or more) between one task starting and the next,
 * without ever touching a task already running. Used both to bound how many tracks a recording
 * transcribes at once, and, with a limit fixed at 1, as a plain mutex (the shared Whisper call).
 */
export function createDynamicPool(options: DynamicPoolOptions): DynamicPool {
  let running = 0;
  const queue: (() => void)[] = [];
  // Only one dispatch loop runs at a time, so "read running, read limit, decide, increment" can
  // never race across two concurrent calls to `run` — each loop iteration commits before the next
  // one reads the limit again.
  let dispatching = false;

  const tryDispatch = async (): Promise<void> => {
    if (dispatching) return;
    dispatching = true;
    try {
      for (;;) {
        if (queue.length === 0) return;
        const limit = await options.currentLimit();
        if (running >= limit || queue.length === 0) return;
        running++;
        const next = queue.shift();
        next?.();
      }
    } finally {
      dispatching = false;
    }
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          void (async () => {
            try {
              await options.gate?.();
              resolve(await task());
            } catch (error) {
              reject(error as Error);
            } finally {
              running--;
              void tryDispatch();
            }
          })();
        });
        void tryDispatch();
      });
    },
  };
}
