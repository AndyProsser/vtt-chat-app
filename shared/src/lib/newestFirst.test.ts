import { describe, expect, it } from 'vitest';

import { newestFirst } from './newestFirst.js';

describe('newestFirst', () => {
  it('turns an oldest-first list round without changing the original', () => {
    const list = ['first', 'second', 'third'];
    expect(newestFirst(list)).toEqual(['third', 'second', 'first']);
    expect(list).toEqual(['first', 'second', 'third']);
  });
  it('is fine with nothing', () => {
    expect(newestFirst([])).toEqual([]);
  });
});
