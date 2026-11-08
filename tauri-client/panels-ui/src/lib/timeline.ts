import type { ChatLine, Member, TableCard, TimelineEntry } from '../types/index.js';

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
  const qty = (card.quantity ?? 1) > 1 ? ` ×${card.quantity}` : '';
  if (!card.claimedBy) return `${card.title}${qty} · available`;
  const taker = members.find((m) => m.userId === card.claimedBy);
  return `${card.title}${qty} · taken by ${taker?.character?.name ?? taker?.displayName ?? 'someone'}`;
}
