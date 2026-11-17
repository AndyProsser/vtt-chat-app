import type { ChatLine, LootItem, TableCard } from '../types/index.js';

/** A row of `GET /api/campaigns/:id/handouts` (what this viewer may see). */
export interface HandoutRow {
  id: string;
  title: string;
  kind: string;
  body: string | null;
  fileCount: number;
  visibility: 'dm' | 'all' | 'some';
  createdAt: number;
}

/** The start of a note for its card (the card clamps it to three lines). */
const EXCERPT_CHARS = 400;

const lootCard = (item: LootItem, after: string | null): TableCard => ({
  id: `loot:${item.id}`,
  kind: 'loot',
  title: item.name,
  quantity: item.quantity,
  ...(item.description ? { description: item.description } : {}),
  ...(item.kind === 'coin' ? { coin: true } : {}),
  itemType: item.itemType,
  rarity: item.rarity,
  claimedBy: item.claimedBy,
  claimedFor: item.claimedFor,
  split: item.split,
  after,
});

const handoutCard = (h: HandoutRow, after: string | null): TableCard => ({
  id: `handout:${h.id}`,
  kind: 'handout',
  title: h.title,
  ...(h.kind === 'image' || h.kind === 'map' || h.kind === 'pdf' || h.kind === 'text'
    ? { handoutKind: h.kind }
    : {}),
  ...(h.body?.trim() ? { excerpt: h.body.trim().slice(0, EXCERPT_CHARS) } : {}),
  fileCount: h.fileCount,
  after,
});

/**
 * The loot and handout cards for the chat that is loaded, rebuilt from the server's lists, so they
 * survive a server restart (the live events that made them are gone then). Each sits after the last
 * line at or before its time; anything older than `windowStart` (where the unbroken loaded history
 * starts) waits until that history is
 * scrolled back, unless the history is `complete`. A handout is placed by when it was made (the server
 * keeps no "shown at"); a DM-only handout was never shown, so it has no card.
 */
export function historyCards(
  loot: LootItem[],
  handouts: HandoutRow[],
  chat: ChatLine[],
  windowStart: number | null,
  complete: boolean,
): TableCard[] {
  const oldest = windowStart ?? Number.NEGATIVE_INFINITY;
  const inWindow = (at: number) => complete || at >= oldest;
  const anchor = (at: number): string | null => {
    let after: string | null = null;
    for (const line of chat) {
      if (line.at > at) break;
      after = line.id;
    }
    return after;
  };
  return [
    ...loot
      .filter((i) => i.droppedAt !== undefined && inWindow(i.droppedAt))
      .map((i) => lootCard(i, anchor(i.droppedAt ?? 0))),
    ...handouts
      .filter((h) => h.visibility !== 'dm' && inWindow(h.createdAt))
      .map((h) => handoutCard(h, anchor(h.createdAt))),
  ];
}
