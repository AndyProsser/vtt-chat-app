import { describe, expect, it } from 'vitest';

import type { ChatLine, LootItem, Member } from '../../types/phone.js';
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

describe('cardsByLine', () => {
  it('puts each card after the last line at or before its drop time', () => {
    const map = cardsByLine(lines, [item('x', 15), item('y', 25), item('z', 20)], false);
    expect(map.get('a')?.map((i) => i.id)).toEqual(['x']);
    expect(map.get('b')?.map((i) => i.id)).toEqual(['z', 'y']);
  });

  it('keeps items older than the loaded chat for the top, only when the history is complete', () => {
    expect(cardsByLine(lines, [item('old', 5)], false).size).toBe(0);
    expect(
      cardsByLine(lines, [item('old', 5)], true)
        .get(null)
        ?.map((i) => i.id),
    ).toEqual(['old']);
  });

  it('with no chat at all shows every card at the top', () => {
    expect(cardsByLine([], [item('x', 15)], false).get(null)).toHaveLength(1);
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
