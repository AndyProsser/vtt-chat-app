/** What a loot item looks like to the code that decides who may do what with it (the desktop panel and the web app both). */
export interface LootHeld {
  claimedBy?: string | null;
  claimedFor?: 'self' | 'party' | 'split' | 'assigned' | null;
}

export type LootAction = 'take' | 'store' | 'return' | 'give';

/**
 * What this person may do with an item right now.
 * - Anyone's unclaimed item: a player can take it or store it in the party stash; the DM can only give
 *   it to one named player (never to the party).
 * - An item a player took (or was given): they can store it or return it.
 * - An item a player stored: they can return it.
 * - Everything else (someone else's, a split pile of coin) offers nothing.
 */
export function lootActions(item: LootHeld, selfId: string | null, dm: boolean): LootAction[] {
  if (!item.claimedBy) return dm ? ['give'] : ['take', 'store'];
  if (dm || item.claimedBy !== selfId) return [];
  if (item.claimedFor === 'self' || item.claimedFor === 'assigned') return ['store', 'return'];
  if (item.claimedFor === 'party') return ['return'];
  return [];
}

export const LOOT_ACTION_LABEL: Record<LootAction, string> = {
  take: 'Take it for yourself',
  store: 'Store it in the party stash',
  return: 'Put it back on the table',
  give: 'Give it to a player…',
};

/** The REST call for an action (relative to `/api/campaigns/:id/loot/:itemId/`): its path and body. `give` needs a `userId`. */
export function lootRequest(
  action: Exclude<LootAction, 'give'>,
  held: LootHeld,
): { path: 'claim' | 'return' | 'store'; body: Record<string, unknown> };
export function lootRequest(
  action: 'give',
  held: LootHeld,
  userId: string,
): { path: 'assign'; body: { userId: string } };
export function lootRequest(
  action: LootAction,
  held: LootHeld,
  userId?: string,
): { path: string; body: Record<string, unknown> } {
  if (action === 'give') return { path: 'assign', body: { userId: userId ?? '' } };
  if (action === 'take') return { path: 'claim', body: { for: 'self' } };
  if (action === 'store' && !held.claimedBy) return { path: 'claim', body: { for: 'party' } };
  return { path: action, body: {} };
}

export type LootFilter = 'all' | 'unassigned' | 'assigned' | 'mine';

/** Which filters make sense: "mine" is for players only (the DM hands loot out, they do not collect it). */
export function lootFiltersFor(dm: boolean): LootFilter[] {
  return dm ? ['all', 'unassigned', 'assigned'] : ['all', 'unassigned', 'assigned', 'mine'];
}

interface Filterable extends LootHeld {
  split?: { shares: { userId: string }[] } | null;
}

/** Items of one filter. Mine = taken by me, given to me, or I hold a share of a split. */
export function filterLootItems<T extends Filterable>(
  items: readonly T[],
  filter: LootFilter,
  selfId: string | null,
): T[] {
  switch (filter) {
    case 'all':
      return [...items];
    case 'unassigned':
      return items.filter((i) => !i.claimedBy);
    case 'assigned':
      return items.filter((i) => !!i.claimedBy);
    case 'mine':
      return selfId === null
        ? []
        : items.filter(
            (i) =>
              i.claimedBy === selfId || (i.split?.shares.some((s) => s.userId === selfId) ?? false),
          );
  }
}
