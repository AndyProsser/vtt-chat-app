import { describe, expect, it } from 'vitest';

import { sparklinePoints } from './sparkline.js';

describe('sparklinePoints', () => {
  it('is empty with no samples', () => {
    expect(sparklinePoints([], 100, 20)).toBe('');
  });

  it('spreads samples across the width, higher values nearer the top', () => {
    expect(sparklinePoints([0, 10], 100, 20, 0)).toBe('0,20 100,0');
  });

  it('draws a flat line mid-height when every sample is equal', () => {
    expect(sparklinePoints([5, 5, 5], 100, 20, 0)).toBe('0,10 50,10 100,10');
  });

  it('draws a single sample as a short flat line', () => {
    expect(sparklinePoints([7], 100, 20, 0)).toBe('0,10 100,10');
  });
});
