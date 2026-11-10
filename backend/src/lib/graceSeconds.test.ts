import { describe, expect, it } from 'vitest';

import { graceSeconds } from './config.js';

describe('graceSeconds (RECORDING_GRACE_SECONDS)', () => {
  it('is 30 when unset, blank or unreadable', () => {
    expect(graceSeconds(undefined)).toBe(30);
    expect(graceSeconds('')).toBe(30);
    expect(graceSeconds('soon')).toBe(30);
  });
  it('takes a whole number of seconds', () => {
    expect(graceSeconds('45')).toBe(45);
    expect(graceSeconds('12.6')).toBe(13);
  });
  it('stays between 5 seconds and an hour', () => {
    expect(graceSeconds('0')).toBe(5);
    expect(graceSeconds('-3')).toBe(5);
    expect(graceSeconds('99999')).toBe(3600);
  });
});
