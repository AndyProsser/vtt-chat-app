import { describe, expect, it } from 'vitest';

import { flip, swipeOf } from './gallery.js';

describe('flip', () => {
  it('moves to the next and previous picture and wraps round the ends', () => {
    expect(flip(0, 3, 1)).toBe(1);
    expect(flip(2, 3, 1)).toBe(0);
    expect(flip(0, 3, -1)).toBe(2);
  });
  it('stays put with one picture or none', () => {
    expect(flip(0, 1, 1)).toBe(0);
    expect(flip(0, 0, -1)).toBe(0);
  });
});

describe('swipeOf', () => {
  it('reads a long, mostly sideways drag as a flip: left goes forward', () => {
    expect(swipeOf(-80, 10)).toBe(1);
    expect(swipeOf(80, -10)).toBe(-1);
  });
  it('ignores a short drag, and a mostly vertical one (that is a scroll)', () => {
    expect(swipeOf(20, 0)).toBe(0);
    expect(swipeOf(60, 90)).toBe(0);
  });
});
