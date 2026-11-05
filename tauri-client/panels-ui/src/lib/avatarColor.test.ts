import { describe, expect, it } from 'vitest';

import { avatarColor } from './avatarColor.js';

describe('avatarColor', () => {
  it('is deterministic for the same identity', () => {
    expect(avatarColor('user-123')).toBe(avatarColor('user-123'));
  });

  it('returns a valid hsl() color string', () => {
    expect(avatarColor('user-123')).toMatch(/^hsl\(\d+, 55%, 45%\)$/);
  });

  it('differs across a small fixture set (not a uniqueness guarantee, just a sanity check)', () => {
    const colors = new Set(['alice', 'bob', 'carol', 'dave'].map(avatarColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});
