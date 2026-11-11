import { describe, expect, it } from 'vitest';

import { compareVersions, isDevVersion } from './version.js';

describe('compareVersions (semver precedence)', () => {
  it('orders by number, not by text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
  it('puts a dev build before the release it leads up to, and dev builds in order', () => {
    expect(compareVersions('0.4.0-dev.1', '0.4.0')).toBeLessThan(0);
    expect(compareVersions('0.4.0-dev.2', '0.4.0-dev.10')).toBeLessThan(0);
    expect(compareVersions('0.4.0-dev.1', '0.4.0-rc.1')).toBeLessThan(0);
    expect(compareVersions('0.4.0-rc.1', '0.3.9')).toBeGreaterThan(0);
  });
  it('rejects something that is not a version', () => {
    expect(() => compareVersions('latest', '1.0.0')).toThrow(/version/);
  });
});

describe('isDevVersion', () => {
  it('is any version with a pre-release part', () => {
    expect(isDevVersion('0.4.0-dev.3')).toBe(true);
    expect(isDevVersion('0.4.0-rc.1')).toBe(true);
    expect(isDevVersion('0.4.0')).toBe(false);
  });
});
