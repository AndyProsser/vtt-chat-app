import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { defaultStart, parseLocalInput, toLocalInput, zoneLabel } from './datetime.js';

beforeAll(() => {
  vi.stubEnv('TZ', 'America/New_York'); // a zone with a DST edge in March and another in November
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe('local datetime conversion', () => {
  it('round-trips an ordinary time', () => {
    const parsed = parseLocalInput('2027-01-15T19:30');
    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) {
      expect(toLocalInput(parsed.ms)).toBe('2027-01-15T19:30');
      expect(new Date(parsed.ms).toISOString()).toBe('2027-01-16T00:30:00.000Z'); // UTC-5 in winter
    }
  });

  it('reads the viewer zone: the same wall time is a different instant in summer', () => {
    const parsed = parseLocalInput('2027-07-15T19:30');
    expect(parsed.ok && new Date(parsed.ms).toISOString()).toBe('2027-07-15T23:30:00.000Z'); // UTC-4
  });

  it('refuses text that is not a datetime-local value', () => {
    for (const bad of [
      '',
      'tomorrow',
      '2027-01-15',
      '2027-01-15 19:30',
      '2027-1-5T9:30',
      '19:30',
    ]) {
      expect(parseLocalInput(bad)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('refuses dates and clocks that do not exist', () => {
    for (const bad of [
      '2027-02-31T10:00',
      '2027-13-01T10:00',
      '2027-00-10T10:00',
      '2027-01-00T10:00',
      '2027-01-10T24:00',
      '2027-01-10T10:60',
    ]) {
      expect(parseLocalInput(bad)).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(parseLocalInput('2028-02-29T10:00').ok).toBe(true); // a leap year
    expect(parseLocalInput('2027-02-29T10:00').ok).toBe(false);
  });

  it('says so when daylight saving skips the time (spring forward, 02:30 does not exist)', () => {
    expect(parseLocalInput('2027-03-14T02:30')).toEqual({ ok: false, reason: 'nonexistent' });
    expect(parseLocalInput('2027-03-14T01:59').ok).toBe(true);
    expect(parseLocalInput('2027-03-14T03:00').ok).toBe(true);
  });

  it('takes the first occurrence of a time that happens twice (fall back, 01:30 twice)', () => {
    const parsed = parseLocalInput('2027-11-07T01:30');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(new Date(parsed.ms).toISOString()).toBe('2027-11-07T05:30:00.000Z'); // still daylight time (UTC-4)
      expect(toLocalInput(parsed.ms)).toBe('2027-11-07T01:30');
    }
  });

  it('keeps the clock when a session is moved across a DST change', () => {
    const before = parseLocalInput('2027-03-13T19:00');
    const after = parseLocalInput('2027-03-14T19:00');
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) expect(after.ms - before.ms).toBe(23 * 3_600_000); // the day is an hour short
  });

  it('writes the value back for the input, padded', () => {
    expect(toLocalInput(new Date(2027, 0, 5, 9, 5).getTime())).toBe('2027-01-05T09:05');
  });
});

describe('defaultStart', () => {
  it('is the next half hour', () => {
    const at = (h: number, m: number, s = 0) => new Date(2027, 5, 1, h, m, s).getTime();
    expect(toLocalInput(defaultStart(at(18, 10)))).toBe('2027-06-01T18:30');
    expect(toLocalInput(defaultStart(at(18, 30)))).toBe('2027-06-01T19:00');
    expect(toLocalInput(defaultStart(at(23, 45)))).toBe('2027-06-02T00:00');
  });
});

describe('zoneLabel', () => {
  it('names the zone and its short form', () => {
    expect(zoneLabel(new Date(2027, 0, 1).getTime(), 'en-US')).toBe('America/New_York (EST)');
    expect(zoneLabel(new Date(2027, 6, 1).getTime(), 'en-US')).toBe('America/New_York (EDT)');
  });
});
