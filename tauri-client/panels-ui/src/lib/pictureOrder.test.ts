import { describe, expect, it } from 'vitest';

import { moveOrder } from './pictureOrder.js';

describe('moveOrder', () => {
  it('swaps a picture with its neighbour', () => {
    expect(moveOrder(4, 1, 1)).toEqual([0, 2, 1, 3]);
    expect(moveOrder(4, 2, -1)).toEqual([0, 2, 1, 3]);
  });
  it('leaves the order alone at either end or for a bad index', () => {
    expect(moveOrder(3, 0, -1)).toEqual([0, 1, 2]);
    expect(moveOrder(3, 2, 1)).toEqual([0, 1, 2]);
    expect(moveOrder(3, 7, 1)).toEqual([0, 1, 2]);
  });
});
