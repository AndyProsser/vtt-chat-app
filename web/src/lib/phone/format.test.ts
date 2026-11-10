import { describe, expect, it } from 'vitest';

import { clock, lineTime, recordingTitle, sessionDistance, sessionWhen } from './format.js';

const at = (h: number, m = 0, day = 12) => new Date(2026, 10, day, h, m).getTime();

describe('phone formatting', () => {
  it('shows a session as day, start and finish', () => {
    expect(sessionWhen(at(19), 180, 'en-AU')).toMatch(/Thu.*12 Nov.*7:00.*10:00/);
  });
  it('says how far off a session is, in the largest unit that fits', () => {
    expect(sessionDistance(at(19, 0, 15), at(19, 0, 12))).toBe('in 3 days');
    expect(sessionDistance(at(21), at(19))).toBe('in 2 hours');
    expect(sessionDistance(at(19, 20), at(19))).toBe('in 20 minutes');
    expect(sessionDistance(at(19), at(20))).toBe('started 1 hour ago');
  });
  it('shows only the clock for today and the date for an older line', () => {
    expect(lineTime(at(9, 5), at(20), 'en-AU')).not.toMatch(/Nov/);
    expect(lineTime(at(9, 5, 10), at(20), 'en-AU')).toMatch(/10 Nov/);
  });
  it('titles a recording with its date and length', () => {
    expect(recordingTitle(at(19), at(22, 30), 'en-AU')).toMatch(/12 Nov 2026 · 3 h 30 min/);
    expect(recordingTitle(at(19), null, 'en-AU')).not.toContain('·');
  });
  it('writes transcript times as m:ss and h:mm:ss', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65_000)).toBe('1:05');
    expect(clock(3_725_000)).toBe('1:02:05');
  });
});
