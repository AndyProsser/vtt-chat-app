import { describe, expect, it } from 'vitest';

import { RARITIES, isItemType, isRarity } from './types.js';
import { findItem, searchItems } from './catalog.js';
import { SRD_ITEMS } from './data.generated.js';

describe('the SRD item data', () => {
  it('has the whole SRD magic item list and the mundane equipment, with unique ids', () => {
    expect(SRD_ITEMS.filter((i) => i.magic).length).toBe(240);
    expect(SRD_ITEMS.filter((i) => !i.magic).length).toBeGreaterThan(190);
    expect(new Set(SRD_ITEMS.map((i) => i.id)).size).toBe(SRD_ITEMS.length);
  });

  it('gives every magic item a real type and one of the SRD rarities, and mundane items none', () => {
    for (const i of SRD_ITEMS) {
      expect(isItemType(i.type), i.name).toBe(true);
      if (i.magic) expect(isRarity(i.rarity), `${i.name}: ${i.rarity}`).toBe(true);
      else expect(i.rarity, i.name).toBeNull();
    }
    expect(RARITIES).toEqual(['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact']);
  });

  it('gets known items right', () => {
    expect(findItem('potion-of-healing')).toMatchObject({
      type: 'potion',
      rarity: 'common',
      magic: true,
    });
    expect(findItem('adamantine-armor')).toMatchObject({ type: 'armor', rarity: 'uncommon' });
    expect(findItem('cloak-of-protection')).toMatchObject({
      type: 'wondrous',
      rarity: 'uncommon',
      attunement: true,
    });
    expect(findItem('ammunition-1-2-or-3')).toMatchObject({
      type: 'ammunition',
      rarity: 'uncommon',
    });
    expect(findItem('longsword')).toMatchObject({ type: 'weapon', magic: false, valueGp: 15 });
    expect(findItem('plate')).toMatchObject({ type: 'armor', valueGp: 1500 });
    expect(findItem('warhorse')).toMatchObject({ type: 'mount', valueGp: 400 });
  });

  it('only has legendary and artifact items at the top of the range', () => {
    const top = SRD_ITEMS.filter((i) => i.rarity === 'artifact');
    expect(top.length).toBeGreaterThan(0);
    expect(SRD_ITEMS.filter((i) => i.rarity === 'legendary').length).toBeGreaterThan(10);
  });
});

describe('searchItems', () => {
  it('matches words in the name, case-insensitively, best matches first', () => {
    const r = searchItems({ query: 'healing' });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.name.toLowerCase()).toContain('healing');
  });
  it('filters by type, rarity and magic, and limits the count', () => {
    expect(searchItems({ type: 'ring', limit: 100 }).every((i) => i.type === 'ring')).toBe(true);
    expect(
      searchItems({ rarity: 'legendary', limit: 100 }).every((i) => i.rarity === 'legendary'),
    ).toBe(true);
    expect(searchItems({ magic: false, limit: 100 }).every((i) => !i.magic)).toBe(true);
    expect(searchItems({ limit: 7 })).toHaveLength(7);
  });
  it('returns nothing for a query that matches nothing', () => {
    expect(searchItems({ query: 'zzzzzz' })).toEqual([]);
  });
});
