import { describe, expect, it } from 'vitest';

import { QUIPS, pickQuip } from './quips.js';

describe('the quips', () => {
  it('has enough of them that a table rarely sees the same one twice', () => {
    expect(QUIPS.length).toBeGreaterThanOrEqual(15);
  });

  it('gives every quip words and a made-up speaker, short enough for a small window', () => {
    for (const q of QUIPS) {
      expect(q.quote.trim().length, q.quote).toBeGreaterThan(10);
      expect(q.quote.length, q.quote).toBeLessThanOrEqual(120);
      expect(q.by.trim().length, q.quote).toBeGreaterThan(3);
    }
  });

  it('has no quip twice', () => {
    expect(new Set(QUIPS.map((q) => q.quote)).size).toBe(QUIPS.length);
  });
});

describe('pickQuip', () => {
  it('picks by the random number it is given', () => {
    expect(pickQuip(() => 0)).toBe(QUIPS[0]);
    expect(pickQuip(() => 0.999999)).toBe(QUIPS[QUIPS.length - 1]);
  });

  it('never repeats the one it is told to avoid', () => {
    for (const q of QUIPS) {
      for (const r of [0, 0.3, 0.7, 0.999999]) {
        expect(pickQuip(() => r, q)).not.toBe(q);
      }
    }
  });
});
