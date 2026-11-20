/** What a loot item looks like to the code that decides who may do what with it (the desktop panel and the web app both). */
export interface LootHeld {
  claimedBy?: string | null;
  claimedFor?: 'self' | 'party' | 'split' | 'assigned' | null;
}

export type LootAction = 'take' | 'store' | 'return' | 'give' | 'redrop';

/**
 * What this person may do with an item right now.
 * - Anyone's unclaimed item: a player can take it or store it in the party stash; the DM can only give
 *   it to one named player (never to the party), or drop it into chat again (it moves there).
 * - An item a player took (or was given): they can store it or return it.
 * - An item in the party stash: any player can take it for themselves or return it to the table.
 * - Everything else (someone else's, a split pile of coin) offers nothing.
 */
export function lootActions(item: LootHeld, selfId: string | null, dm: boolean): LootAction[] {
  if (!item.claimedBy) return dm ? ['give', 'redrop'] : ['take', 'store'];
  if (dm) return [];
  if (item.claimedFor === 'party') return ['take', 'return']; // any player, not only who stored it
  if (item.claimedBy !== selfId) return [];
  if (item.claimedFor === 'self' || item.claimedFor === 'assigned') return ['store', 'return'];
  return [];
}

export const LOOT_ACTION_LABEL: Record<LootAction, string> = {
  take: 'Take it for yourself',
  store: 'Store it in the party stash',
  return: 'Put it back on the table',
  give: 'Give it to a player…',
  redrop: 'Post it in the chat again (moves the card)',
};

/** The REST call for an action (relative to `/api/campaigns/:id/loot/:itemId/`): its path and body. `give` needs a `userId`. */
export function lootRequest(
  action: Exclude<LootAction, 'give'>,
  held: LootHeld,
): { path: 'claim' | 'return' | 'store' | 'redrop'; body: Record<string, unknown> };
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

/** The loot list's filters (ROADMAP Stage 10, 11). The DM: Available | Taken | All. Players: Not confirmed | All | Own | Party | Available. */
export type LootFilter = 'available' | 'taken' | 'all' | 'own' | 'party' | 'unconfirmed';

/** The filters this person gets, in the order they are shown. */
export function lootFiltersFor(dm: boolean): LootFilter[] {
  return dm ? ['available', 'taken', 'all'] : ['unconfirmed', 'all', 'own', 'party', 'available'];
}

/** The filter the list opens on. */
export function defaultLootFilter(dm: boolean): LootFilter {
  // A player opens on what still needs adding to their sheet; the DM on what is left to give out.
  return dm ? 'available' : 'unconfirmed';
}

interface Filterable extends LootHeld {
  split?: { shares: { userId: string; confirmed?: boolean }[] } | null;
  /** "Added to my sheet": the holder's flag, or the party stash's. The server leaves it out of the DM's view. */
  confirmed?: boolean;
}

/**
 * Whether this player still has to put an item on their game sheet: what they hold or were given, the party stash,
 * and their share of a split pile, until it is ticked. The DM has nothing to confirm.
 */
export function needsConfirming(item: Filterable, selfId: string | null): boolean {
  if (selfId === null || !item.claimedBy) return false;
  if (item.claimedFor === 'party') return item.confirmed !== true;
  if (item.claimedFor === 'split') {
    const share = item.split?.shares.find((s) => s.userId === selfId);
    return share !== undefined && share.confirmed !== true;
  }
  return item.claimedBy === selfId && item.confirmed !== true;
}

/** The two groups in the "to confirm" list, in the order they are shown. */
export type ConfirmGroup = 'mine' | 'party';

/** Which group an item belongs to in the "to confirm" list: the party stash, or what this player holds or shares. */
export const confirmGroup = (item: LootHeld): ConfirmGroup =>
  item.claimedFor === 'party' ? 'party' : 'mine';

/** The "to confirm" list grouped: what is mine first, then the party stash, each keeping its order. */
export function groupForConfirming<T extends LootHeld>(
  items: readonly T[],
): { mine: T[]; party: T[] } {
  return {
    mine: items.filter((i) => confirmGroup(i) === 'mine'),
    party: items.filter((i) => confirmGroup(i) === 'party'),
  };
}

/** The number on the loot icon: how many items this player has yet to confirm. */
export function unconfirmedCount(items: readonly Filterable[], selfId: string | null): number {
  return items.filter((i) => needsConfirming(i, selfId)).length;
}

/**
 * Items of one filter. Own = taken by me or given to me, or a split I hold a share of; Party = the party
 * stash. All is everything passed in: the server already leaves other players' own items out of a player's list.
 */
export function filterLootItems<T extends Filterable>(
  items: readonly T[],
  filter: LootFilter,
  selfId: string | null,
): T[] {
  switch (filter) {
    case 'all':
      return [...items];
    case 'available':
      return items.filter((i) => !i.claimedBy);
    case 'taken':
      return items.filter((i) => !!i.claimedBy);
    case 'party':
      return items.filter((i) => i.claimedFor === 'party');
    case 'unconfirmed':
      return items.filter((i) => needsConfirming(i, selfId));
    case 'own':
      return selfId === null
        ? []
        : items.filter(
            (i) =>
              (i.claimedBy === selfId &&
                (i.claimedFor === 'self' || i.claimedFor === 'assigned')) ||
              (i.split?.shares.some((s) => s.userId === selfId) ?? false),
          );
  }
}

/**
 * Whether the "added to my sheet" box belongs on this card for this person: a player's own item, the party stash,
 * or a split they hold a share of (so a tick can be taken back too). Never the DM, never an item on the table.
 */
export function canConfirm(item: Filterable, selfId: string | null, dm: boolean): boolean {
  if (dm || selfId === null || !item.claimedBy) return false;
  if (item.claimedFor === 'party') return true;
  if (item.claimedFor === 'split')
    return item.split?.shares.some((s) => s.userId === selfId) ?? false;
  return item.claimedBy === selfId;
}

/** Whether the box is ticked, for an item `canConfirm` allows. */
export function isConfirmed(item: Filterable, selfId: string | null): boolean {
  return selfId !== null && canConfirm(item, selfId, false) && !needsConfirming(item, selfId);
}
