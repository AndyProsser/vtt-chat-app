import { create } from 'zustand';

import type { Hydration, SyncEvent } from '../types/index.js';
import { applyStatsEvent, type LinkStatsView } from './linkQuality.js';

interface StatsStore {
  byUser: ReadonlyMap<string, LinkStatsView>;
  apply: (event: SyncEvent) => void;
  hydrate: (hydration: Hydration) => void;
}

/**
 * Per-player link stats, kept apart from the table state: they change every few seconds, and
 * folding them into `members` would re-render the whole rail on every sample (the same reason
 * speaking has its own store — STATE-AND-RESILIENCE.md). Only the DM ever receives them.
 */
export const useStatsStore = create<StatsStore>((set) => ({
  byUser: new Map(),
  apply: (event) =>
    set((state) => {
      const next = applyStatsEvent(state.byUser, event);
      return next === state.byUser ? state : { byUser: next };
    }),
  hydrate: ({ snapshot, events }) =>
    set(() => {
      let map: ReadonlyMap<string, LinkStatsView> = new Map();
      for (const e of snapshot ? [snapshot, ...events] : events) map = applyStatsEvent(map, e);
      return { byUser: map };
    }),
}));
