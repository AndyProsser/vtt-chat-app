import { describe, expect, it } from 'vitest';

import {
  defaultLootFilter,
  filterLootItems,
  lootActions,
  lootFiltersFor,
  lootRequest,
} from './lootView.js';

describe('lootActions', () => {
  it('a player can take or store an unclaimed item; the DM can only give it', () => {
    expect(lootActions({ claimedBy: null }, 'p1', false)).toEqual(['take', 'store']);
    expect(lootActions({ claimedBy: null }, 'dm', true)).toEqual(['give']);
  });
  it('what you hold you can store or return; any player can take or return a party item; others’ items offer nothing', () => {
    expect(lootActions({ claimedBy: 'p1', claimedFor: 'self' }, 'p1', false)).toEqual([
      'store',
      'return',
    ]);
    expect(lootActions({ claimedBy: 'p1', claimedFor: 'party' }, 'p1', false)).toEqual([
      'take',
      'return',
    ]);
    expect(lootActions({ claimedBy: 'p2', claimedFor: 'party' }, 'p1', false)).toEqual([
      'take',
      'return',
    ]);
    expect(lootActions({ claimedBy: 'p2', claimedFor: 'party' }, 'dm', true)).toEqual([]);
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
    { id: 'open', claimedBy: null },
    { id: 'mine', claimedBy: 'p1', claimedFor: 'self' as const },
    { id: 'given', claimedBy: 'p1', claimedFor: 'assigned' as const },
    { id: 'stash', claimedBy: 'p2', claimedFor: 'party' as const },
    {
      id: 'split',
      claimedBy: 'p2',
      claimedFor: 'split' as const,
      split: { shares: [{ userId: 'p1' }, { userId: 'p2' }] },
    },
  ];
  const ids = (filter: Parameters<typeof filterLootItems>[1], self: string | null = 'p1') =>
    filterLootItems(items, filter, self).map((i) => i.id);
  it('filters by who holds what', () => {
    expect(ids('available')).toEqual(['open']);
    expect(ids('taken')).toEqual(['mine', 'given', 'stash', 'split']);
    expect(ids('own')).toEqual(['mine', 'given', 'split']);
    expect(ids('party')).toEqual(['stash']);
    expect(ids('all')).toEqual(['open', 'mine', 'given', 'stash', 'split']);
    expect(ids('own', null)).toEqual([]);
  });
  it('offers the DM Available | Taken | All and players All | Own | Party | Available', () => {
    expect(lootFiltersFor(true)).toEqual(['available', 'taken', 'all']);
    expect(lootFiltersFor(false)).toEqual(['all', 'own', 'party', 'available']);
  });
  it('opens on Available for everyone', () => {
    expect(defaultLootFilter(true)).toBe('available');
    expect(defaultLootFilter(false)).toBe('available');
  });
});
