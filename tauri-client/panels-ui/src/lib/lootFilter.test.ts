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
  it('all is everything the server sent', () => {
    expect(ids(filterLoot(items, 'all', 'me'))).toEqual(ids(items));
  });
  it('available is what is still in the pool; taken is whatever anyone has taken, stored or been given', () => {
    expect(ids(filterLoot(items, 'available', 'me'))).toEqual(['open']);
    expect(ids(filterLoot(items, 'taken', 'me'))).toEqual([
      'mine',
      'theirs',
      'given',
      'gold',
      'others-gold',
    ]);
  });
  it('own is what I took, was given, or got a share of in a split; party is the stash', () => {
    expect(ids(filterLoot(items, 'own', 'me'))).toEqual(['mine', 'given', 'gold']);
    expect(filterLoot(items, 'own', null)).toEqual([]);
    expect(ids(filterLoot(items, 'party', 'me'))).toEqual(['theirs']);
  });
});

describe('filtersFor', () => {
  it('offers the DM Available | Taken | All, and players New | Available | Mine | Party | All', () => {
    expect(filtersFor(false)).toEqual(['unconfirmed', 'available', 'own', 'party', 'all']);
    expect(filtersFor(true)).toEqual(['available', 'taken', 'all']);
  });
});
