import type { ChatLine, HandoutItem, LootItem, Member } from '../../types/phone.js';

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

/** A card among the chat lines: a loot item or a shared handout. */
export type ChatCard = { kind: 'loot'; item: LootItem } | { kind: 'handout'; item: HandoutItem };

/**
 * Where each card sits in the chat: after the last line at or before the item's time (a loot item's drop, a
 * handout's creation; key = that line's id, `null` = the top, before every line), in time order. Cards come from
 * the server's lists, so they are always current and survive a restart. Items older than the oldest loaded line
 * wait until that history is loaded (`complete` = nothing older to load), then sit at the top. A DM-only draft
 * handout was never shown, so it has no card.
 */
export function cardsByLine(
  lines: readonly ChatLine[],
  loot: readonly LootItem[],
  handouts: readonly HandoutItem[],
  complete: boolean,
): Map<string | null, ChatCard[]> {
  const out = new Map<string | null, ChatCard[]>();
  const oldest = lines[0]?.at;
  const all: { at: number; card: ChatCard }[] = [
    ...loot.map((item) => ({ at: item.droppedAt, card: { kind: 'loot', item } as ChatCard })),
    ...handouts
      .filter((h) => h.visibility !== 'dm')
      .map((item) => ({ at: item.createdAt, card: { kind: 'handout', item } as ChatCard })),
  ].sort((x, y) => x.at - y.at);
  for (const { at, card } of all) {
    if (oldest !== undefined && at < oldest && !complete) continue;
    let after: string | null = null;
    for (const l of lines) {
      if (l.at > at) break;
      after = l.id;
    }
    out.set(after, [...(out.get(after) ?? []), card]);
  }
  return out;
}
