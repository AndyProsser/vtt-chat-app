import { beforeEach, describe, expect, it } from 'vitest';

import { CORNER_STORAGE_KEY, DEFAULT_CORNER, cornerStyle, getCorner, setCorner } from './corner.js';

describe('corner', () => {
  beforeEach(() => {
    localStorage.removeItem(CORNER_STORAGE_KEY);
  });

  it('defaults to top-left when nothing is stored', () => {
    expect(getCorner()).toBe(DEFAULT_CORNER);
    expect(DEFAULT_CORNER).toBe('top-left');
  });

  it('setCorner persists, getCorner reads it back', () => {
    setCorner('bottom-right');
    expect(getCorner()).toBe('bottom-right');
  });

  it('ignores an invalid stored value and falls back to the default', () => {
    localStorage.setItem(CORNER_STORAGE_KEY, 'not-a-corner');
    expect(getCorner()).toBe(DEFAULT_CORNER);
  });

  it('cornerStyle anchors to the correct edges', () => {
    expect(cornerStyle('top-left')).toBe('top: 0 !important; left: 0 !important');
    expect(cornerStyle('top-right')).toBe('top: 0 !important; right: 0 !important');
    expect(cornerStyle('bottom-left')).toBe('bottom: 0 !important; left: 0 !important');
    expect(cornerStyle('bottom-right')).toBe('bottom: 0 !important; right: 0 !important');
  });
});
