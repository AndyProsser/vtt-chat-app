import { describe, expect, it } from 'vitest';

import { levelToBars } from './level.js';

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
