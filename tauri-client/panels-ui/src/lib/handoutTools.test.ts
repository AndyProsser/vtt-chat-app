import { describe, expect, it } from 'vitest';

import type { Handout } from '../types/index.js';
import {
  imageFromClipboard,
  isShared,
  pastedTitle,
  removalWarning,
  searchHandouts,
} from './handoutTools.js';

const h = (over: Partial<Handout>): Handout => ({
  id: 'h',
  title: 'Crypt map',
  kind: 'map',
  body: null,
  hasFile: true,
  visibility: 'dm',
  ...over,
});

describe('searchHandouts', () => {
  const list = [
    h({ id: '1', title: 'Crypt map' }),
    h({
      id: '2',
      title: 'The old priest',
      kind: 'text',
      body: 'He fears the water beneath the crypt.',
    }),
    h({ id: '3', title: 'Tavern menu', kind: 'text', body: 'Stew, ale.' }),
  ];
  it('matches every word against the title or the text, in any case', () => {
    expect(searchHandouts(list, 'CRYPT').map((x) => x.id)).toEqual(['1', '2']);
    expect(searchHandouts(list, 'crypt water').map((x) => x.id)).toEqual(['2']);
  });
  it('returns everything for a blank search and nothing for a miss', () => {
    expect(searchHandouts(list, '  ')).toHaveLength(3);
    expect(searchHandouts(list, 'dragon')).toEqual([]);
  });
});

describe('removal', () => {
  it('knows when a handout has been shown to players', () => {
    expect(isShared(h({ visibility: 'dm' }))).toBe(false);
    expect(isShared(h({ visibility: 'all' }))).toBe(true);
    expect(isShared(h({ visibility: 'some' }))).toBe(true);
  });
  it('warns only for a shared one, naming who loses it', () => {
    expect(removalWarning(h({ visibility: 'dm' }))).toBeNull();
    expect(removalWarning(h({ visibility: 'all' }))).toMatch(/shown to the players/i);
    expect(removalWarning(h({ visibility: 'some' }))).toMatch(/shown to some players/i);
  });
});

describe('imageFromClipboard', () => {
  const file = (type: string) => new File(['x'], 'a', { type });
  const item = (kind: string, type: string, f: File | null) => ({ kind, type, getAsFile: () => f });
  it('takes the first image on the clipboard', () => {
    const png = file('image/png');
    expect(
      imageFromClipboard([item('string', 'text/plain', null), item('file', 'image/png', png)]),
    ).toBe(png);
  });
  it('ignores text, other files and an empty clipboard', () => {
    expect(imageFromClipboard([item('string', 'text/plain', null)])).toBeUndefined();
    expect(
      imageFromClipboard([item('file', 'application/zip', file('application/zip'))]),
    ).toBeUndefined();
    expect(imageFromClipboard([])).toBeUndefined();
  });
});

describe('pastedTitle', () => {
  it('names a pasted picture by the time, so the title is never blank', () => {
    expect(pastedTitle(new Date(2026, 10, 8, 16, 5))).toBe('Picture 8 Nov 16:05');
  });
});
