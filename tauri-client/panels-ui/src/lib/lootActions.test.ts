import { describe, expect, it } from 'vitest';

import { lootActions } from './lootActions.js';

const free = { claimedBy: null, claimedFor: null };

describe('lootActions', () => {
  it('lets a player take or store an unclaimed item, and the DM only give it', () => {
    expect(lootActions(free, 'p1', false)).toEqual(['take', 'store']);
    expect(lootActions(free, 'dm', true)).toEqual(['give']);
  });
  it('lets whoever took or was given an item store it or put it back', () => {
    expect(lootActions({ claimedBy: 'p1', claimedFor: 'self' }, 'p1', false)).toEqual([
      'store',
      'return',
    ]);
    expect(lootActions({ claimedBy: 'p1', claimedFor: 'assigned' }, 'p1', false)).toEqual([
      'store',
      'return',
    ]);
  });
  it('lets whoever stored an item put it back, but not store it again', () => {
    expect(lootActions({ claimedBy: 'p1', claimedFor: 'party' }, 'p1', false)).toEqual(['return']);
  });
  it('offers nothing on someone else’s item, a split pile, or to the DM once it is taken', () => {
    expect(lootActions({ claimedBy: 'p2', claimedFor: 'self' }, 'p1', false)).toEqual([]);
    expect(lootActions({ claimedBy: 'p1', claimedFor: 'split' }, 'p1', false)).toEqual([]);
    expect(lootActions({ claimedBy: 'p1', claimedFor: 'self' }, 'dm', true)).toEqual([]);
    expect(lootActions(free, null, false)).toEqual(['take', 'store']);
  });
});
