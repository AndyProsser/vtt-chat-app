import { describe, expect, it } from 'vitest';

import type { ChatLine, LootItem, TableCard } from '../types/index.js';
import { historyCards, type HandoutRow } from './historyCards.js';
import { emptyTable, restoreCards } from './tableModel.js';

const line = (id: string, at: number): ChatLine => ({
  id,
  from: { userId: 'p1', name: 'Pat' },
  text: id,
  at,
  kind: 'chat',
});
const loot = (id: string, droppedAt: number, over: Partial<LootItem> = {}): LootItem => ({
  id,
  kind: 'item',
  itemType: 'wondrous',
  rarity: 'rare',
  srdId: null,
  name: id,
  description: 'shiny',
  quantity: 1,
  claimedBy: null,
  claimedFor: null,
  split: null,
  droppedAt,
  ...over,
});
const handout = (id: string, createdAt: number, over: Partial<HandoutRow> = {}): HandoutRow => ({
  id,
  title: id,
  kind: 'text',
  body: 'A note',
  fileCount: 0,
  visibility: 'all',
  createdAt,
  ...over,
});
const chat = [line('a', 10), line('b', 20)];

describe('historyCards', () => {
  it('anchors each card after the last line at or before its time', () => {
    const cards = historyCards([loot('x', 15), loot('y', 25)], [handout('h', 20)], chat, false);
    expect(cards.map((c) => [c.id, c.after])).toEqual([
      ['loot:x', 'a'],
      ['loot:y', 'b'],
      ['handout:h', 'b'],
    ]);
  });

  it('leaves out what is older than the loaded chat, unless the history is complete', () => {
    expect(historyCards([loot('old', 5)], [], chat, false)).toEqual([]);
    expect(historyCards([loot('old', 5)], [], chat, true)[0]).toMatchObject({
      id: 'loot:old',
      after: null,
    });
  });

  it('keeps a claim, coin and the card fields', () => {
    const [card] = historyCards(
      [
        loot('gp', 12, {
          kind: 'coin',
          itemType: 'coin',
          name: 'gp',
          quantity: 30,
          claimedBy: 'p1',
          claimedFor: 'self',
        }),
      ],
      [],
      chat,
      false,
    );
    expect(card).toMatchObject({
      kind: 'loot',
      title: 'gp',
      quantity: 30,
      coin: true,
      claimedBy: 'p1',
      claimedFor: 'self',
    });
  });

  it('never makes a card for a DM-only handout', () => {
    expect(historyCards([], [handout('draft', 15, { visibility: 'dm' })], chat, false)).toEqual([]);
  });
});

describe('restoreCards', () => {
  it('adds missing cards and never overwrites a live one', () => {
    const live: TableCard = {
      id: 'loot:x',
      kind: 'loot',
      title: 'x',
      claimedBy: 'p2',
      after: null,
    };
    const state = { ...emptyTable, cards: [live] };
    const next = restoreCards(state, [
      { id: 'loot:x', kind: 'loot', title: 'x', claimedBy: null, after: 'a' },
      { id: 'loot:y', kind: 'loot', title: 'y', claimedBy: null, after: 'a' },
    ]);
    expect(next.cards).toHaveLength(2);
    expect(next.cards[0]).toBe(live);
    expect(restoreCards(next, [])).toBe(next);
  });
});
