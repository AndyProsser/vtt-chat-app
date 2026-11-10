import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFY_PREFS,
  minuteOf,
  quietLabel,
  timeOf,
  withQuiet,
  withoutQuiet,
} from './notifyPrefs.js';

describe('notification preferences', () => {
  it('starts with everything on and no quiet hours', () => {
    expect(DEFAULT_NOTIFY_PREFS).toEqual({
      chat: true,
      whispers: true,
      table: true,
      sessions: true,
      quiet: null,
    });
  });
  it('converts between the half-hour pickers and minutes after midnight', () => {
    expect(minuteOf('00:00')).toBe(0);
    expect(minuteOf('22:30')).toBe(22 * 60 + 30);
    expect(timeOf(8 * 60)).toBe('08:00');
    expect(timeOf(23 * 60 + 30)).toBe('23:30');
  });
  it('turns quiet hours on at 22:00 to 08:00 and off again', () => {
    const on = withQuiet(DEFAULT_NOTIFY_PREFS);
    expect(on.quiet).toEqual({ from: 22 * 60, to: 8 * 60 });
    expect(withoutQuiet(on).quiet).toBeNull();
  });
  it('describes the window in words', () => {
    expect(quietLabel({ from: 22 * 60, to: 8 * 60 })).toBe('22:00 to 08:00');
  });
});
