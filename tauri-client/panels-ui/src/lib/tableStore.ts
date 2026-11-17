import { create } from 'zustand';

import type { ChatLine, Hydration, SyncEvent, TableState } from '../types/index.js';
import { addOlder, applyEvent, emptyTable } from './tableModel.js';

interface TableStore extends TableState {
  apply: (event: SyncEvent) => void;
  hydrate: (hydration: Hydration) => void;
  addOlder: (lines: ChatLine[], done: boolean) => void;
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
        : {
            members: next.members,
            chat: next.chat,
            cards: next.cards,
            recording: next.recording,
            parties: next.parties,
            notices: next.notices,
            partiesSeen: next.partiesSeen,
            historyDone: next.historyDone,
          };
    }),
  hydrate: ({ snapshot, events }) =>
    set(() => {
      let state: TableState = emptyTable;
      if (snapshot) state = applyEvent(state, snapshot);
      for (const event of events) state = applyEvent(state, event);
      return {
        members: state.members,
        chat: state.chat,
        cards: state.cards,
        recording: state.recording,
        parties: state.parties,
        notices: state.notices,
        partiesSeen: state.partiesSeen,
        historyDone: state.historyDone,
      };
    }),
  addOlder: (lines, done) =>
    set((state) => {
      const next = addOlder(state, lines, done);
      return { chat: next.chat, historyDone: next.historyDone };
    }),
}));
