import { describe, expect, it } from 'vitest';

import {
  groupForConfirming,
  defaultLootFilter,
  smartLootFilter,
  filterLootItems,
  lootActions,
  lootFiltersFor,
  canConfirm,
  isConfirmed,
  needsConfirming,
  unconfirmedCount,
  lootRequest,
} from './lootView.js';

describe('lootActions', () => {
  it('a player can take or store an unclaimed item; the DM can only give it', () => {
    expect(lootActions({ claimedBy: null }, 'p1', false)).toEqual(['take', 'store']);
    expect(lootActions({ claimedBy: null }, 'dm', true)).toEqual(['give', 'redrop']);
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
    expect(lootFiltersFor(false)).toEqual(['unconfirmed', 'all', 'own', 'party', 'available']);
  });
  it('opens on Available for everyone', () => {
    expect(defaultLootFilter(true)).toBe('available');
    expect(defaultLootFilter(false)).toBe('unconfirmed');
  });
});

describe('smartLootFilter: open where there is something to do', () => {
  const open = { claimedBy: null };
  const mine = { claimedBy: 'p1', claimedFor: 'self' as const, confirmed: true };
  const unticked = { claimedBy: 'p1', claimedFor: 'self' as const };
  it('opens a player on what still needs adding to their sheet', () => {
    expect(smartLootFilter([unticked, open], 'p1', false)).toBe('unconfirmed');
  });
  it('then on what is left to take', () => {
    expect(smartLootFilter([mine, open], 'p1', false)).toBe('available');
  });
  it('then on what they own', () => {
    expect(smartLootFilter([mine], 'p1', false)).toBe('own');
    expect(smartLootFilter([], 'p1', false)).toBe('own');
  });
  it('opens the Game Master on what is left to give out', () => {
    expect(smartLootFilter([unticked, mine], 'dm', true)).toBe('available');
  });
});

describe('the added-to-my-sheet flag', () => {
  const mine = { claimedBy: 'p1', claimedFor: 'self' as const };
  it('counts what a player holds, the party stash and their share of a split until ticked', () => {
    expect(needsConfirming(mine, 'p1')).toBe(true);
    expect(needsConfirming({ ...mine, confirmed: true }, 'p1')).toBe(false);
    expect(needsConfirming({ claimedBy: 'p2', claimedFor: 'party' }, 'p1')).toBe(true);
    expect(needsConfirming({ claimedBy: 'p2', claimedFor: 'party', confirmed: true }, 'p1')).toBe(
      false,
    );
    const split = (confirmed?: boolean) => ({
      claimedBy: 'dm',
      claimedFor: 'split' as const,
      split: {
        shares: [
          { userId: 'p1', ...(confirmed === undefined ? {} : { confirmed }) },
          { userId: 'p2' },
        ],
      },
    });
    expect(needsConfirming(split(), 'p1')).toBe(true);
    expect(needsConfirming(split(true), 'p1')).toBe(false);
    expect(needsConfirming(split(), 'p3')).toBe(false);
  });
  it("is nothing for the DM, for someone else's item, or for an item still on the table", () => {
    expect(needsConfirming(mine, 'p2')).toBe(false);
    expect(needsConfirming({ claimedBy: null }, 'p1')).toBe(false);
    expect(needsConfirming(mine, null)).toBe(false);
  });
  it('counts them for the badge and filters the list', () => {
    const items = [
      mine,
      { ...mine, confirmed: true },
      { claimedBy: 'p2', claimedFor: 'party' as const },
      { claimedBy: null },
    ];
    expect(unconfirmedCount(items, 'p1')).toBe(2);
    expect(filterLootItems(items, 'unconfirmed', 'p1')).toHaveLength(2);
  });
});

describe('where the box belongs', () => {
  const held = { claimedBy: 'p1', claimedFor: 'self' as const };
  it("is on a player's own item, the party stash and their share, never for the DM", () => {
    expect(canConfirm(held, 'p1', false)).toBe(true);
    expect(canConfirm(held, 'p2', false)).toBe(false);
    expect(canConfirm({ claimedBy: 'p2', claimedFor: 'party' }, 'p1', false)).toBe(true);
    expect(canConfirm(held, 'dm', true)).toBe(false);
    expect(canConfirm({ claimedBy: null }, 'p1', false)).toBe(false);
    expect(isConfirmed({ ...held, confirmed: true }, 'p1')).toBe(true);
    expect(isConfirmed(held, 'p1')).toBe(false);
  });
});

describe('the to-confirm groups', () => {
  it('puts what I hold, was given or share first, then the party stash, each keeping its order', () => {
    const a = { id: 'a', claimedBy: 'me', claimedFor: 'party' as const };
    const b = { id: 'b', claimedBy: 'me', claimedFor: 'self' as const };
    const c = { id: 'c', claimedBy: 'dm', claimedFor: 'assigned' as const };
    const d = { id: 'd', claimedBy: 'x', claimedFor: 'party' as const };
    const e = { id: 'e', claimedBy: 'dm', claimedFor: 'split' as const };
    const g = groupForConfirming([a, b, c, d, e]);
    expect(g.mine.map((i) => i.id)).toEqual(['b', 'c', 'e']);
    expect(g.party.map((i) => i.id)).toEqual(['a', 'd']);
  });
});
