import { describe, expect, it } from 'vitest';

import { monthGrid, parseIso, shiftMonth, toIso } from './calendar.js';

describe('calendar', () => {
  it('round-trips an ISO date', () => {
    expect(toIso(2026, 10, 5)).toBe('2026-11-05');
    expect(parseIso('2026-11-05')).toEqual({ year: 2026, month: 10, day: 5 });
    expect(parseIso('nope')).toBeUndefined();
  });
  it('lays November 2026 out Monday-first (the 1st is a Sunday)', () => {
    const rows = monthGrid(2026, 10);
    expect(rows[0]).toEqual([null, null, null, null, null, null, 1]);
    expect(rows.at(-1)?.[0]).toBe(30);
    expect(rows.every((r) => r.length === 7)).toBe(true);
  });
  it('rolls the year over when shifting months', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
});
