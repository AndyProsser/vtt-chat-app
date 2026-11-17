import type { LootItem } from './tableStore.js';

/**
 * What a member may see in the loot list. The DM sees everything. A player sees what is still on the
 * table, the party stash, and their own: what they took or were given, and a split they hold a share
 * of. Never another player's own items (decided 2026-11-17, ROADMAP Stage 10).
 */
export function visibleLoot(items: LootItem[], viewerId: string, dm: boolean): LootItem[] {
  if (dm) return items;
  return items.filter(
    (i) =>
      i.claimedBy === null ||
      i.claimedFor === 'party' ||
      (i.claimedBy === viewerId && (i.claimedFor === 'self' || i.claimedFor === 'assigned')) ||
      (i.split?.shares.some((s) => s.userId === viewerId) ?? false),
  );
}
