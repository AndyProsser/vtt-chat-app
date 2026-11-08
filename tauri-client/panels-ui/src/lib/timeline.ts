import type { ChatLine, LootItem, Member, TableCard, TimelineEntry } from '../types/index.js';

/**
 * Chat lines in order with each loot/handout card placed right after the line it followed. A card
 * whose line has since scrolled out of the kept window goes to the top; removed cards are hidden.
 */
export function timeline(chat: ChatLine[], cards: TableCard[]): TimelineEntry[] {
  const live = cards.filter((c) => !c.removed);
  const known = new Set(chat.map((l) => l.id));
  const card = (c: TableCard): TimelineEntry => ({ type: 'card', card: c });
  const out: TimelineEntry[] = live
    .filter((c) => c.after === null || !known.has(c.after))
    .map(card);
  for (const line of chat) {
    out.push({ type: 'line', line });
    for (const c of live) if (c.after === line.id) out.push(card(c));
  }
  return out;
}

/** The one-line text of a card. */
export function cardLabel(card: TableCard, members: Member[]): string {
  if (card.kind === 'handout') return `Handout: ${card.title}`;
  const what = card.coin
    ? `${card.quantity ?? 0} ${card.title}`
    : `${card.title}${(card.quantity ?? 1) > 1 ? ` ×${card.quantity}` : ''}`;
  if (!card.claimedBy) return `${what} · available`;
  if (card.claimedFor === 'split' && card.split) {
    const { shares, remainder } = card.split;
    const each = shares[0]?.amount ?? 0;
    const left = remainder > 0 ? ` (${remainder} left over)` : '';
    return `${what} · split ${each} each among ${shares.length}${left}`;
  }
  const taker = members.find((m) => m.userId === card.claimedBy);
  const name = taker?.character?.name ?? taker?.displayName ?? 'someone';
  return `${what} · taken by ${name}${card.claimedFor === 'party' ? ' for the party' : ''}`;
}

/** The same wording for an item fetched from the server (the Party inventory window). */
export function itemLabel(item: LootItem, members: Member[]): string {
  return cardLabel(
    {
      id: item.id,
      kind: 'loot',
      title: item.name,
      quantity: item.quantity,
      ...(item.kind === 'coin' ? { coin: true } : {}),
      claimedBy: item.claimedBy,
      claimedFor: item.claimedFor,
      split: item.split,
      after: null,
    },
    members,
  );
}
