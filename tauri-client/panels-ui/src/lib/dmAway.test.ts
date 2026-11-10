import { describe, expect, it } from 'vitest';

import { dmAwayLongEnough } from './dmAway.js';

describe('dmAwayLongEnough', () => {
  const grace = 30;
  it('is false while the DM is connected, or when nobody knows when they left', () => {
    expect(dmAwayLongEnough(null, 100_000, grace)).toBe(false);
  });
  it('turns true exactly when the grace period has passed', () => {
    expect(dmAwayLongEnough(70_000, 99_999, grace)).toBe(false);
    expect(dmAwayLongEnough(70_000, 100_000, grace)).toBe(true);
  });
  it('uses 30 seconds when the server did not say', () => {
    expect(dmAwayLongEnough(0, 29_999, undefined)).toBe(false);
    expect(dmAwayLongEnough(0, 30_000, undefined)).toBe(true);
  });
});
