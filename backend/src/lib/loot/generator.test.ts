import { SRD_ITEMS, findItem, isRarity } from '@vtt-chat-app/shared';
import { describe, expect, it } from 'vitest';

import { bandOf, rerollDraft, rollHoard, rollIndividual, type Draft } from './generator.js';

/** A small seeded generator so every run of a test sees the same dice. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COIN_GP: Record<string, number> = { cp: 0.01, sp: 0.1, gp: 1, pp: 10 };
const coinValue = (drafts: Draft[]) =>
  drafts
    .filter((d) => d.kind === 'coin')
    .reduce((n, d) => n + d.quantity * (COIN_GP[d.name] ?? 0), 0);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('bandOf', () => {
  it('splits challenge ratings into the four treasure bands', () => {
    expect([0, 0.25, 4].map(bandOf)).toEqual([1, 1, 1]);
    expect([5, 10].map(bandOf)).toEqual([2, 2]);
    expect([11, 16].map(bandOf)).toEqual([3, 3]);
    expect([17, 30].map(bandOf)).toEqual([4, 4]);
  });
});

describe('individual treasure', () => {
  it('is only coin, in real denominations, and grows with the challenge rating', () => {
    const averages = [1, 6, 12, 20].map((cr) => {
      const rng = seeded(cr);
      return mean(Array.from({ length: 200 }, () => coinValue(rollIndividual(cr, rng))));
    });
    for (let seed = 0; seed < 50; seed += 1) {
      for (const d of rollIndividual(8, seeded(seed))) {
        expect(d.kind).toBe('coin');
        expect(Object.keys(COIN_GP)).toContain(d.name);
        expect(d.quantity).toBeGreaterThan(0);
        expect(Number.isInteger(d.quantity)).toBe(true);
      }
    }
    expect(averages[0]!).toBeLessThan(averages[1]!);
    expect(averages[1]!).toBeLessThan(averages[2]!);
    expect(averages[2]!).toBeLessThan(averages[3]!);
  });

  it('is the same for the same dice', () => {
    expect(rollIndividual(9, seeded(5))).toEqual(rollIndividual(9, seeded(5)));
  });
});

describe('treasure hoards', () => {
  const hoards = (cr: number, n = 300) =>
    Array.from({ length: n }, (_, i) => rollHoard(cr, seeded(i + 1)));
  const magic = (list: Draft[][]) => list.flat().filter((d) => d.rarity !== null);

  it('holds coin and often gems, art and magic items, all with a type for the icon', () => {
    const all = hoards(8).flat();
    expect(all.some((d) => d.kind === 'coin')).toBe(true);
    expect(all.some((d) => d.itemType === 'gem')).toBe(true);
    expect(all.some((d) => d.itemType === 'art')).toBe(true);
    expect(magic(hoards(8)).length).toBeGreaterThan(0);
    for (const d of all) {
      expect(d.name).toBeTruthy();
      expect(d.quantity).toBeGreaterThan(0);
      expect(d.itemType).toBeTruthy();
    }
  });

  it('only draws real SRD magic items, filed under their own type and rarity', () => {
    for (const d of magic(hoards(14))) {
      const item = findItem(d.srdId ?? '');
      expect(item, d.name).toBeDefined();
      expect(item).toMatchObject({ name: d.name, type: d.itemType, rarity: d.rarity });
    }
  });

  it('scales the rarity of magic items with the challenge rating, and never rolls an artifact', () => {
    const low = magic(hoards(2)).map((d) => d.rarity);
    const high = magic(hoards(20)).map((d) => d.rarity);
    expect(low.length).toBeGreaterThan(0);
    expect(low.every((r) => r === 'common' || r === 'uncommon' || r === 'rare')).toBe(true);
    expect(high.some((r) => r === 'legendary')).toBe(true);
    expect(high.every((r) => r === 'rare' || r === 'very rare' || r === 'legendary')).toBe(true);
    for (const r of [...low, ...high]) expect(isRarity(r) && r !== 'artifact').toBe(true);
  });

  it('is worth more at higher levels', () => {
    const value = (cr: number) => mean(hoards(cr, 150).map(coinValue));
    expect(value(3)).toBeLessThan(value(8));
    expect(value(8)).toBeLessThan(value(14));
    expect(value(14)).toBeLessThan(value(20));
  });
});

describe('rerollDraft', () => {
  it('swaps a magic item for a different one of the same rarity', () => {
    const original = rollHoard(14, seeded(3)).find((d) => d.rarity !== null)!;
    expect(original).toBeDefined();
    for (let seed = 1; seed < 30; seed += 1) {
      const next = rerollDraft(original, 14, seeded(seed));
      expect(next.rarity).toBe(original.rarity);
      expect(next.srdId).not.toBe(original.srdId);
      expect(next.kind).toBe('item');
    }
  });

  it('rerolls a coin pile as the same coin, and a gem as another gem of its band', () => {
    const coin = rollIndividual(8, seeded(2))[0]!;
    const again = rerollDraft(coin, 8, seeded(9));
    expect(again.kind).toBe('coin');
    expect(again.name).toBe(coin.name);
    const gem = rollHoard(14, seeded(11)).find((d) => d.itemType === 'gem')!;
    expect(rerollDraft(gem, 14, seeded(4)).itemType).toBe('gem');
  });

  it('knows there are enough magic items in the SRD to reroll from', () => {
    expect(SRD_ITEMS.filter((i) => i.rarity === 'rare').length).toBeGreaterThan(10);
  });
});
