import type { ChatLine, LootItem, Member } from '../../types/phone.js';

/** The name a player goes by at the table: their character's, else their own. */
export const nameOf = (members: Member[], id: string | null): string => {
  const m = members.find((x) => x.userId === id);
  return m?.character?.name ?? m?.displayName ?? 'someone';
};

/** Who has it, in words: "Available", "Taken by Mira", "In the party stash", "Split among 3". */
export function holder(item: LootItem, members: Member[]): string {
  if (!item.claimedBy) return 'Available';
  if (item.claimedFor === 'split' && item.split) return `Split among ${item.split.shares.length}`;
  if (item.claimedFor === 'party') return 'In the party stash';
  const who = nameOf(members, item.claimedBy);
  return item.claimedFor === 'assigned' ? `Given to ${who}` : `Taken by ${who}`;
}

/**
 * Where each loot card sits in the chat: after the last line at or before the item's drop time (key = that
 * line's id; `null` = the top, before every line). Cards come from the loot list, so they are always current
 * and survive a server restart. Items dropped before the oldest loaded line wait until that history is loaded
 * (`complete` = nothing older to load), then sit at the top.
 */
export function cardsByLine(
  lines: readonly ChatLine[],
  loot: readonly LootItem[],
  complete: boolean,
): Map<string | null, LootItem[]> {
  const out = new Map<string | null, LootItem[]>();
  const oldest = lines[0]?.at;
  for (const item of [...loot].sort((x, y) => x.droppedAt - y.droppedAt)) {
    if (oldest !== undefined && item.droppedAt < oldest && !complete) continue;
    let after: string | null = null;
    for (const l of lines) {
      if (l.at > item.droppedAt) break;
      after = l.id;
    }
    out.set(after, [...(out.get(after) ?? []), item]);
  }
  return out;
}
