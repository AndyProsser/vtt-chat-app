import { describe, expect, it } from 'vitest';

import { elapsedSince, formatElapsed } from './elapsed.js';

describe('elapsed time', () => {
  it('formats milliseconds as HH:MM:SS', () => {
    expect(formatElapsed(0)).toBe('00:00:00');
    expect(formatElapsed(3_723_000)).toBe('01:02:03');
  });

  it('never shows a negative or NaN time', () => {
    expect(formatElapsed(-5)).toBe('00:00:00');
    expect(formatElapsed(Number.NaN)).toBe('00:00:00');
  });

  it('is zero when the start is unknown or in the future', () => {
    expect(elapsedSince(null, 5)).toBe(0);
    expect(elapsedSince(2000, 1000)).toBe(0);
    expect(elapsedSince(1000, 66_000)).toBe(65_000);
  });
});
