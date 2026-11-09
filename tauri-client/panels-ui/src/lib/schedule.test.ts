import { describe, expect, it } from 'vitest';

import {
  attendanceOpen,
  canDelete,
  slotOf,
  DURATION_OPTIONS,
  TIME_OPTIONS,
  defaultSlot,
  formatRange,
  nextSessionTitle,
  startsAtOf,
} from './schedule.js';

describe('nextSessionTitle', () => {
  it('is Session 1 with nothing scheduled', () => {
    expect(nextSessionTitle([])).toBe('Session 1');
  });
  it('continues from the highest "Session N" among the titles', () => {
    expect(nextSessionTitle(['Session 3', 'Session 11 — the crypt', 'Session 4'])).toBe(
      'Session 12',
    );
    expect(nextSessionTitle(['session 7'])).toBe('Session 8');
  });
  it('falls back to counting when titles carry no number', () => {
    expect(nextSessionTitle(['Prologue', 'The heist'])).toBe('Session 3');
  });
});

describe('the time and duration pickers', () => {
  it('offers every half hour of the day', () => {
    expect(TIME_OPTIONS).toHaveLength(48);
    expect(TIME_OPTIONS[0]).toBe('00:00');
    expect(TIME_OPTIONS[1]).toBe('00:30');
    expect(TIME_OPTIONS[47]).toBe('23:30');
  });
  it('offers durations in half hours from 30 minutes to 8 hours, three hours first-class', () => {
    expect(DURATION_OPTIONS[0]).toBe(30);
    expect(DURATION_OPTIONS.at(-1)).toBe(480);
    expect(DURATION_OPTIONS.every((d) => d % 30 === 0)).toBe(true);
    expect(DURATION_OPTIONS).toContain(180);
  });
  it('suggests the next half hour, rolling the date at midnight', () => {
    expect(defaultSlot(new Date(2026, 10, 8, 14, 12))).toEqual({
      date: '2026-11-08',
      time: '14:30',
    });
    expect(defaultSlot(new Date(2026, 10, 8, 14, 30))).toEqual({
      date: '2026-11-08',
      time: '15:00',
    });
    expect(defaultSlot(new Date(2026, 10, 8, 23, 50))).toEqual({
      date: '2026-11-09',
      time: '00:00',
    });
  });
  it('combines a local date and time into the instant, and refuses nonsense', () => {
    expect(startsAtOf('2026-11-08', '14:30')).toBe(new Date(2026, 10, 8, 14, 30).getTime());
    expect(startsAtOf('', '14:30')).toBeUndefined();
    expect(startsAtOf('2026-11-08', 'late')).toBeUndefined();
  });
});

describe('formatRange', () => {
  it('shows start and finish, with the day when it runs past midnight', () => {
    const start = new Date(2026, 10, 11, 19, 0).getTime();
    expect(formatRange(start, 180, 'en-AU')).toMatch(/7:00.*10:00/);
    expect(formatRange(start, 300, 'en-AU')).toMatch(/12:00/);
    expect(formatRange(start, 300, 'en-AU')).toMatch(/Thu/);
  });
});

describe('attendance window', () => {
  const HOUR = 3_600_000;
  it('stays open until four hours after the start', () => {
    expect(attendanceOpen(1_000_000, 1_000_000 - HOUR)).toBe(true);
    expect(attendanceOpen(1_000_000, 1_000_000 + 4 * HOUR)).toBe(true);
    expect(attendanceOpen(1_000_000, 1_000_000 + 4 * HOUR + 1)).toBe(false);
  });
});

describe('slotOf and canDelete', () => {
  it('turns an instant back into the local date and time the pickers show', () => {
    const at = startsAtOf('2026-11-15', '13:30')!;
    expect(slotOf(at)).toEqual({ date: '2026-11-15', time: '13:30' });
  });
  it('lets only a session that has not started be deleted', () => {
    expect(canDelete(2_000, 1_000)).toBe(true);
    expect(canDelete(1_000, 1_000)).toBe(false);
    expect(canDelete(500, 1_000)).toBe(false);
  });
});
