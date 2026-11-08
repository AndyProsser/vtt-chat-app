import { describe, expect, it } from 'vitest';

import { RARITIES, glowLevel, rarityLabel, typeLabel } from './itemStyle.js';

describe('rarity glow', () => {
  it('grows with each step up the SRD rarity ladder, and mundane items do not glow', () => {
    const levels = RARITIES.map((r) => glowLevel(r));
    expect(levels[0]).toBeGreaterThan(0);
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]!).toBeGreaterThan(levels[i - 1]!);
    expect(glowLevel(null)).toBe(0);
  });
  it('uses the SRD rarity names', () => {
    expect(RARITIES).toEqual(['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact']);
    expect(rarityLabel('very rare')).toBe('Very rare');
    expect(rarityLabel(null)).toBe('');
  });
});

describe('typeLabel', () => {
  it('names every item type for tooltips', () => {
    expect(typeLabel('wondrous')).toBe('Wondrous item');
    expect(typeLabel('potion')).toBe('Potion');
    expect(typeLabel('other')).toBe('Item');
  });
});
