import { useEffect, useState } from 'react';

import { POLL_MS } from '../consts/index.js';
import { fetchStatus } from '../lib/api.js';
import type { StatusSnapshot } from '../types/index.js';

/** Polls while the tab is visible; a hidden tab makes no requests. `reachable` is false when the server did not answer. */
export function useStatus(): { snapshot: StatusSnapshot | undefined; reachable: boolean } {
  const [snapshot, setSnapshot] = useState<StatusSnapshot>();
  const [reachable, setReachable] = useState(true);
  useEffect(() => {
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const tick = () => {
      controller?.abort();
      controller = new AbortController();
      fetchStatus(controller.signal).then(
        (s) => {
          setSnapshot(s);
          setReachable(true);
        },
        (e: unknown) => {
          if ((e as { name?: string }).name !== 'AbortError') setReachable(false);
        },
      );
    };
    const start = () => {
      tick();
      timer = window.setInterval(tick, POLL_MS);
    };
    const stop = () => {
      window.clearInterval(timer);
      controller?.abort();
    };
    const onVisibility = () => {
      stop();
      if (document.visibilityState === 'visible') start();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, []);
  return { snapshot, reachable };
}
