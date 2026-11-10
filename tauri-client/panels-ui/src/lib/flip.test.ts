import { describe, expect, it } from 'vitest';

import { flip } from './flip.js';

describe('flip', () => {
  it('moves forward and back, wrapping at both ends', () => {
    expect(flip(0, 3, 1)).toBe(1);
    expect(flip(2, 3, 1)).toBe(0);
    expect(flip(0, 3, -1)).toBe(2);
  });
  it('stays on the only slide', () => {
    expect(flip(0, 1, 1)).toBe(0);
    expect(flip(0, 0, -1)).toBe(0);
  });
});
