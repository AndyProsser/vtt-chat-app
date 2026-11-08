import { describe, expect, it } from 'vitest';

import { contrastRatio } from './contrast.js';

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for identical colours', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#d9a441', '#1a1412')).toBeCloseTo(contrastRatio('#1a1412', '#d9a441'), 6);
  });
});
