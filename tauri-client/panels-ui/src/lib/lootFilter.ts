import type { LootItem } from '../types/index.js';

export type LootFilter = 'all' | 'unassigned' | 'assigned' | 'mine';

/** Which filters make sense: "mine" is for players only (the DM hands loot out, they do not collect it). */
export function filtersFor(dm: boolean): LootFilter[] {
  return dm ? ['all', 'unassigned', 'assigned'] : ['all', 'unassigned', 'assigned', 'mine'];
}

/** Items of one filter. Mine = taken by me, given to me, or I hold a share of a split. */
export function filterLoot(
  items: LootItem[],
  filter: LootFilter,
  selfId: string | null,
): LootItem[] {
  switch (filter) {
    case 'all':
      return items;
    case 'unassigned':
      return items.filter((i) => i.claimedBy === null);
    case 'assigned':
      return items.filter((i) => i.claimedBy !== null);
    case 'mine':
      return selfId === null
        ? []
        : items.filter(
            (i) =>
              i.claimedBy === selfId || (i.split?.shares.some((s) => s.userId === selfId) ?? false),
          );
  }
}
