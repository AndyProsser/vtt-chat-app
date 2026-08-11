import { afterEach, describe, expect, it } from 'vitest';

import { classifyPage, OVERLAY_EVERYWHERE_STORAGE_KEY } from './pageMode.js';

afterEach(() => {
  localStorage.removeItem(OVERLAY_EVERYWHERE_STORAGE_KEY);
});

describe('classifyPage', () => {
  it('classifies a Maps VTT URL as full', () => {
    expect(classifyPage(new URL('https://www.dndbeyond.com/games/1234'))).toBe('full');
  });

  it('classifies a Maps VTT URL with a trailing path as full', () => {
    expect(classifyPage(new URL('https://www.dndbeyond.com/games/1234/session'))).toBe('full');
  });

  it('classifies a non-Maps DDB page as pill', () => {
    expect(classifyPage(new URL('https://www.dndbeyond.com/characters/999'))).toBe('pill');
  });

  it('classifies the bare characters list as pill', () => {
    expect(classifyPage(new URL('https://www.dndbeyond.com/characters'))).toBe('pill');
  });

  it('forces full everywhere when the debug flag is set', () => {
    localStorage.setItem(OVERLAY_EVERYWHERE_STORAGE_KEY, '1');
    expect(classifyPage(new URL('https://www.dndbeyond.com/characters'))).toBe('full');
  });
});
