import { describe, expect, it } from 'vitest';

import type { LootItem } from '../types/index.js';
import { filterLoot, filtersFor } from './lootFilter.js';

const item = (id: string, over: Partial<LootItem> = {}): LootItem => ({
  id,
  kind: 'item',
  itemType: 'gear',
  rarity: null,
  srdId: null,
  name: id,
  description: '',
  quantity: 1,
  claimedBy: null,
  claimedFor: null,
  split: null,
  ...over,
});

const items = [
  item('open'),
  item('mine', { claimedBy: 'me', claimedFor: 'self' }),
  item('theirs', { claimedBy: 'bob', claimedFor: 'party' }),
  item('given', { claimedBy: 'me', claimedFor: 'assigned' }),
  item('gold', {
    kind: 'coin',
    claimedBy: 'bob',
    claimedFor: 'split',
    split: {
      shares: [
        { userId: 'me', amount: 5 },
        { userId: 'bob', amount: 5 },
      ],
      remainder: 0,
    },
  }),
  item('others-gold', {
    kind: 'coin',
    claimedBy: 'bob',
    claimedFor: 'split',
    split: { shares: [{ userId: 'bob', amount: 10 }], remainder: 0 },
  }),
];
const ids = (xs: LootItem[]) => xs.map((i) => i.id);

describe('filterLoot', () => {
  it('shows everything by default', () => {
    expect(ids(filterLoot(items, 'all', 'me'))).toEqual(ids(items));
  });
  it('unassigned is what is still in the pool; assigned is whatever anyone has taken or been given', () => {
    expect(ids(filterLoot(items, 'unassigned', 'me'))).toEqual(['open']);
    expect(ids(filterLoot(items, 'assigned', 'me'))).toEqual([
      'mine',
      'theirs',
      'given',
      'gold',
      'others-gold',
    ]);
  });
  it('mine is what I took, was given, or got a share of in a split', () => {
    expect(ids(filterLoot(items, 'mine', 'me'))).toEqual(['mine', 'given', 'gold']);
    expect(filterLoot(items, 'mine', null)).toEqual([]);
  });
});

describe('filtersFor', () => {
  it('offers "mine" to players only: the DM does not collect', () => {
    expect(filtersFor(false)).toEqual(['all', 'unassigned', 'assigned', 'mine']);
    expect(filtersFor(true)).toEqual(['all', 'unassigned', 'assigned']);
  });
});
