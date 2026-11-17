import { describe, expect, it } from 'vitest';

import { trackLeaving, withLeaving } from './leaving.js';

const a = { id: 'a' };
const b = { id: 'b' };
const c = { id: 'c' };

describe('leaving items', () => {
  it('an item that drops out of the list is kept as leaving', () => {
    const leaving = trackLeaving([a, b, c], [a, c], new Map());
    expect([...leaving.keys()]).toEqual(['b']);
  });

  it('an item that comes back is no longer leaving', () => {
    const leaving = trackLeaving([a, c], [a, b, c], new Map([['b', b]]));
    expect(leaving.size).toBe(0);
  });

  it('shows leaving items in their place, marked', () => {
    const items = withLeaving([a, c], new Map([['b', b]]), ['a', 'b', 'c']);
    expect(items).toEqual([a, { id: 'b', leaving: true }, c]);
  });

  it('puts a leaving item that is gone from the data at the end', () => {
    expect(withLeaving([a], new Map([['x', { id: 'x' }]]), ['a'])).toEqual([
      a,
      { id: 'x', leaving: true },
    ]);
  });
});
