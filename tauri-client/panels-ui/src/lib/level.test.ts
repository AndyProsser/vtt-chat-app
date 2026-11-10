import { describe, expect, it } from 'vitest';

import { barZone, levelToBars } from './level.js';

describe('levelToBars', () => {
  it('lights none at silence, all at full, half at half', () => {
    expect(levelToBars(0)).toBe(0);
    expect(levelToBars(1)).toBe(8);
    expect(levelToBars(0.5)).toBe(4);
    expect(levelToBars(0.5, 10)).toBe(5);
  });
  it('clamps out-of-range and non-numeric levels', () => {
    expect(levelToBars(-1)).toBe(0);
    expect(levelToBars(2)).toBe(8);
    expect(levelToBars(Number.NaN)).toBe(0);
  });
});

describe('barZone', () => {
  it('is green for most of the bar, amber near the top, and red only on the last bar', () => {
    const zones = Array.from({ length: 8 }, (_, i) => barZone(i + 1, 8));
    expect(zones).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'warm', 'warm', 'hot']);
  });
  it('keeps the same proportions for a different number of bars', () => {
    expect(barZone(10, 10)).toBe('hot');
    expect(barZone(1, 10)).toBe('ok');
  });
});
