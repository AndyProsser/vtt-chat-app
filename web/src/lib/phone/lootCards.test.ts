import { describe, expect, it } from 'vitest';

import type { ChatLine, HandoutItem, LootItem, Member } from '../../types/phone.js';
import { cardsByLine, holder } from './lootCards.js';

const line = (id: string, at: number): ChatLine =>
  ({ id, at, fromId: 'p', fromName: 'Pat', toId: null, text: id, kind: 'chat' }) as ChatLine;
const item = (id: string, droppedAt: number, over: Partial<LootItem> = {}): LootItem => ({
  id,
  kind: 'item',
  itemType: 'weapon',
  rarity: null,
  name: id,
  description: '',
  quantity: 1,
  droppedAt,
  claimedBy: null,
  claimedFor: null,
  split: null,
  ...over,
});
const lines = [line('a', 10), line('b', 20)];

const handout = (id: string, createdAt: number, over: Partial<HandoutItem> = {}): HandoutItem => ({
  id,
  title: id,
  kind: 'text',
  body: null,
  fileCount: 0,
  visibility: 'all',
  createdAt,
  ...over,
});
const ids = (cards: { kind: string; item: { id: string } }[] | undefined) =>
  (cards ?? []).map((c) => `${c.kind}:${c.item.id}`);

describe('cardsByLine', () => {
  it('puts each card after the last line at or before its time, loot and handouts in time order', () => {
    const map = cardsByLine(
      lines,
      [item('x', 15), item('y', 25), item('z', 20)],
      [handout('h', 22)],
      false,
    );
    expect(ids(map.get('a'))).toEqual(['loot:x']);
    expect(ids(map.get('b'))).toEqual(['loot:z', 'handout:h', 'loot:y']);
  });

  it('keeps items older than the loaded chat for the top, only when the history is complete', () => {
    expect(cardsByLine(lines, [item('old', 5)], [], false).size).toBe(0);
    expect(ids(cardsByLine(lines, [item('old', 5)], [], true).get(null))).toEqual(['loot:old']);
  });

  it('with no chat at all shows every card at the top', () => {
    expect(cardsByLine([], [item('x', 15)], [handout('h', 16)], false).get(null)).toHaveLength(2);
  });

  it('never makes a card for a DM-only draft handout', () => {
    const map = cardsByLine(lines, [], [handout('draft', 15, { visibility: 'dm' })], true);
    expect(map.size).toBe(0);
  });
});

describe('holder', () => {
  const members = [
    { userId: 'u1', displayName: 'Andy', role: 'player', character: { name: 'Shadow' } },
  ] as Member[];
  it('says who has it, in words', () => {
    expect(holder(item('x', 1), members)).toBe('Available');
    expect(holder(item('x', 1, { claimedBy: 'u1', claimedFor: 'self' }), members)).toBe(
      'Taken by Shadow',
    );
    expect(holder(item('x', 1, { claimedBy: 'u1', claimedFor: 'assigned' }), members)).toBe(
      'Given to Shadow',
    );
    expect(holder(item('x', 1, { claimedBy: 'u1', claimedFor: 'party' }), members)).toBe(
      'In the party stash',
    );
  });
});
