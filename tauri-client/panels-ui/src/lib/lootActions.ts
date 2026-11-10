export type LootAction = 'take' | 'store' | 'return' | 'give';

interface Held {
  claimedBy?: string | null;
  claimedFor?: 'self' | 'party' | 'split' | 'assigned' | null;
}

/**
 * What this person may do with an item right now.
 * - Anyone's unclaimed item: a player can take it or store it in the party stash; the DM can only give
 *   it to one named player (never to the party).
 * - An item a player took (or was given): they can store it or return it.
 * - An item a player stored: they can return it.
 * - Everything else (someone else's, a split pile of coin) offers nothing.
 */
export function lootActions(item: Held, selfId: string | null, dm: boolean): LootAction[] {
  if (!item.claimedBy) return dm ? ['give'] : ['take', 'store'];
  if (dm || item.claimedBy !== selfId) return [];
  if (item.claimedFor === 'self' || item.claimedFor === 'assigned') return ['store', 'return'];
  if (item.claimedFor === 'party') return ['return'];
  return [];
}

export const ACTION_LABEL: Record<LootAction, string> = {
  take: 'Take it for yourself',
  store: 'Store it in the party stash',
  return: 'Put it back on the table',
  give: 'Give it to a player…',
};
