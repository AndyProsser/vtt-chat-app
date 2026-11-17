import { useEffect, type RefObject } from 'react';

import { historyCards, type HandoutRow } from '../lib/historyCards.js';
import { useTableStore } from '../lib/tableStore.js';
import { campaignApi } from '../lib/tauriBridge.js';
import type { LootItem } from '../types/index.js';

/**
 * Puts the loot and handout cards back into the loaded chat from the server's lists: after a snapshot
 * and after each older page, i.e. whenever the start of the loaded history moves (not on every new line).
 * Live events keep them current after that; a card already in the chat is never overwritten. Cards land
 * inside the part already on screen, so the view is moved by the height they added, keeping the line
 * being read in place.
 */
export function useRestoredCards(scroller: RefObject<HTMLElement | null>): void {
  const historyBefore = useTableStore((s) => s.historyBefore);
  const done = useTableStore((s) => s.historyDone);
  useEffect(() => {
    if (historyBefore === null) return;
    let cancelled = false;
    void Promise.all([
      campaignApi<{ loot: LootItem[] }>('GET', 'loot'),
      campaignApi<{ handouts: HandoutRow[] }>('GET', 'handouts'),
    ]).then(
      ([{ loot }, { handouts }]) => {
        if (cancelled) return;
        const { chat, restoreCards } = useTableStore.getState();
        const el = scroller.current;
        const before = el?.scrollHeight;
        restoreCards(historyCards(loot, handouts, chat, historyBefore, done));
        requestAnimationFrame(() => {
          if (el && before !== undefined) el.scrollTop += el.scrollHeight - before;
        });
      },
      // Cards are a nicety on top of the chat; the live events still bring new ones.
      (e: unknown) => console.warn('[panels-ui] could not restore chat cards', e),
    );
    return () => {
      cancelled = true;
    };
  }, [historyBefore, done, scroller]);
}
