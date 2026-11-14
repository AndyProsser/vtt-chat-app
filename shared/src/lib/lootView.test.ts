import { describe, expect, it } from 'vitest';

import { filterLootItems, lootActions, lootFiltersFor, lootRequest } from './lootView.js';

describe('lootActions', () => {
  it('a player can take or store an unclaimed item; the DM can only give it', () => {
    expect(lootActions({ claimedBy: null }, 'p1', false)).toEqual(['take', 'store']);
    expect(lootActions({ claimedBy: null }, 'dm', true)).toEqual(['give']);
  });
  it('what you hold you can store or return; the party stash can only be returned; others’ items offer nothing', () => {
    expect(lootActions({ claimedBy: 'p1', claimedFor: 'self' }, 'p1', false)).toEqual([
      'store',
      'return',
    ]);
    expect(lootActions({ claimedBy: 'p1', claimedFor: 'party' }, 'p1', false)).toEqual(['return']);
    expect(lootActions({ claimedBy: 'p2', claimedFor: 'self' }, 'p1', false)).toEqual([]);
    expect(lootActions({ claimedBy: 'p1', claimedFor: 'self' }, 'dm', true)).toEqual([]);
  });
});

describe('lootRequest', () => {
  it('maps each action to the server call', () => {
    expect(lootRequest('take', { claimedBy: null })).toEqual({
      path: 'claim',
      body: { for: 'self' },
    });
    expect(lootRequest('store', { claimedBy: null })).toEqual({
      path: 'claim',
      body: { for: 'party' },
    });
    expect(lootRequest('store', { claimedBy: 'p1' })).toEqual({ path: 'store', body: {} });
    expect(lootRequest('return', { claimedBy: 'p1' })).toEqual({ path: 'return', body: {} });
    expect(lootRequest('give', { claimedBy: null }, 'p2')).toEqual({
      path: 'assign',
      body: { userId: 'p2' },
    });
  });
});

describe('filterLootItems', () => {
  const items = [
    { id: 'a', claimedBy: null },
    { id: 'b', claimedBy: 'p1' },
    { id: 'c', claimedBy: 'p2', split: { shares: [{ userId: 'p1' }, { userId: 'p2' }] } },
  ];
  it('filters by who holds what', () => {
    expect(filterLootItems(items, 'unassigned', 'p1').map((i) => i.id)).toEqual(['a']);
    expect(filterLootItems(items, 'assigned', 'p1').map((i) => i.id)).toEqual(['b', 'c']);
    expect(filterLootItems(items, 'mine', 'p1').map((i) => i.id)).toEqual(['b', 'c']);
    expect(filterLootItems(items, 'mine', null)).toEqual([]);
  });
  it('“mine” is for players only', () => {
    expect(lootFiltersFor(true)).not.toContain('mine');
    expect(lootFiltersFor(false)).toContain('mine');
  });
});
