import { describe, expect, it } from 'vitest';

import { EMBLEMS, avatarValue, emblemOf, emblemValue, uploadedAvatarId } from './avatars.js';

describe('emblems', () => {
  it('stores a built-in emblem as emblem:<name> and reads it back', () => {
    expect(emblemValue('sword')).toBe('emblem:sword');
    expect(emblemOf('emblem:sword')).toBe('sword');
  });
  it('ignores web addresses, blanks, unknown emblems and nonsense', () => {
    expect(emblemOf('https://example.com/a.png')).toBeUndefined();
    expect(emblemOf(null)).toBeUndefined();
    expect(emblemOf('')).toBeUndefined();
    expect(emblemOf('emblem:not-a-real-one')).toBeUndefined();
  });
  it('every emblem is a valid server-side avatar value (lowercase letters, digits, dashes)', () => {
    for (const name of EMBLEMS) expect(emblemValue(name)).toMatch(/^emblem:[a-z0-9-]{1,30}$/);
    expect(new Set(EMBLEMS).size).toBe(EMBLEMS.length);
  });
});

describe('uploaded portraits', () => {
  const id = '0b1f3a52-6c1e-4d57-9a64-0c2f7d3e8a11';
  it('round-trips an id through the avatar value', () => {
    expect(avatarValue(id)).toBe(`avatar:${id}`);
    expect(uploadedAvatarId(`avatar:${id}`)).toBe(id);
  });
  it('ignores emblems, web addresses, empties and malformed ids', () => {
    for (const v of ['emblem:sword', 'https://x.test/a.png', '', null, undefined, 'avatar:nope']) {
      expect(uploadedAvatarId(v)).toBeUndefined();
    }
  });
});
