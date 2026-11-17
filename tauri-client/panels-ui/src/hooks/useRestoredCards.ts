import { useEffect } from 'react';

import { historyCards, type HandoutRow } from '../lib/historyCards.js';
import { useTableStore } from '../lib/tableStore.js';
import { campaignApi } from '../lib/tauriBridge.js';
import type { LootItem } from '../types/index.js';

/**
 * Puts the loot and handout cards back into the loaded chat from the server's lists: after the chat
 * is (re)loaded and after each older page, i.e. whenever the oldest loaded line changes. Live events
 * keep them current after that; a card already in the chat is never overwritten.
 */
export function useRestoredCards(): void {
  const firstId = useTableStore((s) => s.chat[0]?.id);
  const done = useTableStore((s) => s.historyDone);
  useEffect(() => {
    if (firstId === undefined) return;
    let cancelled = false;
    void Promise.all([
      campaignApi<{ loot: LootItem[] }>('GET', 'loot'),
      campaignApi<{ handouts: HandoutRow[] }>('GET', 'handouts'),
    ]).then(
      ([{ loot }, { handouts }]) => {
        if (cancelled) return;
        const { chat, restoreCards } = useTableStore.getState();
        restoreCards(historyCards(loot, handouts, chat, done));
      },
      // Cards are a nicety on top of the chat; the live events still bring new ones.
      (e: unknown) => console.warn('[panels-ui] could not restore chat cards', e),
    );
    return () => {
      cancelled = true;
    };
  }, [firstId, done]);
}
