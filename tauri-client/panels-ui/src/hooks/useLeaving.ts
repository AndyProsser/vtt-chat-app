import { useEffect, useMemo, useState } from 'react';

import { trackLeaving, withLeaving } from '../lib/leaving.js';

/** How long an item that left the list stays, fading, before it goes. */
export const LEAVING_MS = 1200;

const sameKeys = (a: ReadonlyMap<string, unknown>, b: ReadonlyMap<string, unknown>) =>
  a.size === b.size && [...a.keys()].every((k) => b.has(k));

interface Memory<T> {
  shown: T[];
  view: string;
  leaving: ReadonlyMap<string, T>;
}

/**
 * Keeps an item that drops out of `shown` (given, taken, split…) in the list, marked `leaving`, for
 * `LEAVING_MS`, so the eye sees it go instead of the list silently jumping. Changing `view` (the filter)
 * starts afresh. The leaving set is worked out **during the render** that first lacks the item, so the row
 * stays mounted and its opacity transition runs (doing it in an effect unmounted the row for one render and
 * it came back already faded: no fade, found on Windows 2026-11-18). One timer, only while something leaves.
 */
export function useLeaving<T extends { id: string }>(
  shown: T[],
  order: string[],
  view: string,
): (T & { leaving?: true })[] {
  const [memory, setMemory] = useState<Memory<T>>({ shown, view, leaving: new Map() });
  let current = memory;
  if (memory.view !== view) {
    current = { shown, view, leaving: new Map() };
  } else if (memory.shown !== shown) {
    const next = trackLeaving(memory.shown, shown, memory.leaving);
    current = { shown, view, leaving: sameKeys(next, memory.leaving) ? memory.leaving : next };
  }
  if (current !== memory) setMemory(current); // React re-renders at once, before anything is painted

  const { leaving } = current;
  useEffect(() => {
    if (leaving.size === 0) return;
    const timer = setTimeout(
      () => setMemory((m) => (m.leaving === leaving ? { ...m, leaving: new Map() } : m)),
      LEAVING_MS,
    );
    return () => clearTimeout(timer);
  }, [leaving]);

  return useMemo(() => withLeaving(shown, leaving, order), [shown, leaving, order]);
}
