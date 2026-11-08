import { describe, expect, it } from 'vitest';

import { GROUP_NAMES, pickGroupName } from './groupNames.js';

const seeded = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('GROUP_NAMES', () => {
  it('has plenty of distinct names, each short enough for the server (60 characters)', () => {
    expect(GROUP_NAMES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(GROUP_NAMES.map((n) => n.toLowerCase())).size).toBe(GROUP_NAMES.length);
    for (const n of GROUP_NAMES) expect(n.length).toBeLessThanOrEqual(60);
  });
});

describe('pickGroupName', () => {
  it('picks a name by the dice', () => {
    expect(pickGroupName([], seeded([0]))).toBe(GROUP_NAMES[0]);
    expect(pickGroupName([], seeded([0.999999]))).toBe(GROUP_NAMES.at(-1));
  });
  it('never repeats a name already in use, whatever the case', () => {
    const used = [GROUP_NAMES[0]!.toUpperCase()];
    for (let i = 0; i < 50; i += 1) {
      expect(used.map((u) => u.toLowerCase())).not.toContain(
        pickGroupName(used, seeded([i / 50])).toLowerCase(),
      );
    }
  });
  it('still gives a fresh name when every one has been used', () => {
    const next = pickGroupName([...GROUP_NAMES], seeded([0]));
    expect(GROUP_NAMES).not.toContain(next);
    expect(next.length).toBeLessThanOrEqual(60);
    const another = pickGroupName([...GROUP_NAMES, next], seeded([0]));
    expect(another).not.toBe(next);
  });
});
