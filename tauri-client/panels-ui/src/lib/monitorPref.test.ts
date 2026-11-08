import { afterEach, describe, expect, it, vi } from 'vitest';

import { readMonitorPref, writeMonitorPref } from './monitorPref.js';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('monitor preference', () => {
  it('is on until turned off, and remembers the choice', () => {
    expect(readMonitorPref()).toBe(true);
    writeMonitorPref(false);
    expect(readMonitorPref()).toBe(false);
    writeMonitorPref(true);
    expect(readMonitorPref()).toBe(true);
  });
  it('stays on when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readMonitorPref()).toBe(true);
  });
});
