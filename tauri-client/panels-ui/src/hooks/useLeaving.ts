import { useEffect, useMemo, useRef, useState } from 'react';

import { trackLeaving, withLeaving } from '../lib/leaving.js';

/** How long an item that left the list stays, fading, before it goes. */
export const LEAVING_MS = 1200;

const sameKeys = (a: ReadonlyMap<string, unknown>, b: ReadonlyMap<string, unknown>) =>
  a.size === b.size && [...a.keys()].every((k) => b.has(k));

/**
 * Keeps an item that drops out of `shown` (given, taken, split…) in the list, marked `leaving`, for
 * `LEAVING_MS`, so the eye sees it go instead of the list silently jumping. Changing `view` (the filter)
 * starts afresh: items hidden by a filter switch just go. One timer, only while something is leaving.
 */
export function useLeaving<T extends { id: string }>(
  shown: T[],
  order: string[],
  view: string,
): (T & { leaving?: true })[] {
  const previous = useRef({ shown, view });
  const [leaving, setLeaving] = useState<ReadonlyMap<string, T>>(new Map());

  useEffect(() => {
    const prev = previous.current;
    previous.current = { shown, view };
    if (prev.view !== view) {
      setLeaving((l) => (l.size === 0 ? l : new Map()));
      return;
    }
    if (prev.shown === shown) return;
    setLeaving((l) => {
      const next = trackLeaving(prev.shown, shown, l);
      return sameKeys(next, l) ? l : next;
    });
  }, [shown, view]);

  useEffect(() => {
    if (leaving.size === 0) return;
    const timer = setTimeout(() => setLeaving(new Map()), LEAVING_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return useMemo(() => withLeaving(shown, leaving, order), [shown, leaving, order]);
}
