import { describe, expect, it } from 'vitest';

import { clampZoom, MAX_ZOOM, MIN_ZOOM, stepZoom, zoomLabel } from './zoom.js';

describe('zoom', () => {
  it('steps in and out by a quarter and back to exactly 100%', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1.25, -1)).toBe(1);
    expect(zoomLabel(stepZoom(1, 1))).toBe('125%');
  });
  it('never leaves the allowed range', () => {
    let z = 1;
    for (let i = 0; i < 40; i++) z = stepZoom(z, 1);
    expect(z).toBe(MAX_ZOOM);
    for (let i = 0; i < 80; i++) z = stepZoom(z, -1);
    expect(z).toBe(MIN_ZOOM);
  });
  it('treats a nonsense value as 100%', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
  });
});
