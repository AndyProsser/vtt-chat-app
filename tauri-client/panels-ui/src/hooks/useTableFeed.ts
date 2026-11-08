import { useEffect } from 'react';

import { useStatsStore } from '../lib/statsStore.js';
import { useTableStore } from '../lib/tableStore.js';
import { onSyncEvent, panelHydrate } from '../lib/tauriBridge.js';

/**
 * Keeps the table store in step with Rust: listen first, then hydrate (snapshot + the events since),
 * so nothing falls in the gap; the model is idempotent, so the overlap is harmless. Call once per
 * panel. Nothing runs after the panel's window is closed — it is destroyed, not hidden.
 */
export function useTableFeed(): void {
  const apply = useTableStore((s) => s.apply);
  const hydrate = useTableStore((s) => s.hydrate);
  useEffect(() => {
    let cancelled = false;
    const stats = useStatsStore.getState();
    const unlisten = onSyncEvent((event) => {
      if (cancelled) return;
      apply(event);
      stats.apply(event);
    });
    void panelHydrate().then(
      (h) => {
        if (cancelled) return;
        hydrate(h);
        stats.hydrate(h);
      },
      (e: unknown) => console.error('[panels-ui] hydrate failed', e),
    );
    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, [apply, hydrate]);
}
