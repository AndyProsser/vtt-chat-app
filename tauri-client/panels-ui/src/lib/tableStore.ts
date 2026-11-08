import { create } from 'zustand';

import type { Hydration, SyncEvent, TableState } from '../types/index.js';
import { applyEvent, emptyTable } from './tableModel.js';

interface TableStore extends TableState {
  apply: (event: SyncEvent) => void;
  hydrate: (hydration: Hydration) => void;
}

/**
 * A cache of Rust's feed (STATE-AND-RESILIENCE.md). `hydrate` rebuilds from the snapshot plus the
 * tail; `apply` follows live events. Leaf components select a single field.
 */
export const useTableStore = create<TableStore>((set) => ({
  ...emptyTable,
  apply: (event) =>
    set((state) => {
      const next = applyEvent(state, event);
      return next === state
        ? state
        : { members: next.members, chat: next.chat, recording: next.recording };
    }),
  hydrate: ({ snapshot, events }) =>
    set(() => {
      let state: TableState = emptyTable;
      if (snapshot) state = applyEvent(state, snapshot);
      for (const event of events) state = applyEvent(state, event);
      return { members: state.members, chat: state.chat, recording: state.recording };
    }),
}));
