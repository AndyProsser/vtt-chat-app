import { describe, expect, it } from 'vitest';

import type { Handout } from '../types/index.js';
import {
  canCreateHandout,
  fileFromBase64,
  imageFromClipboard,
  isShared,
  MAX_PICTURES,
  pastedTitle,
  plainPreview,
  removalWarning,
  searchHandouts,
} from './handoutTools.js';

const h = (over: Partial<Handout>): Handout => ({
  id: 'h',
  title: 'Crypt map',
  kind: 'map',
  body: null,
  hasFile: true,
  fileCount: 1,
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
  it('also finds a picture in the files list when the items list has none', () => {
    const png = file('image/png');
    expect(imageFromClipboard([], [png])).toBe(png);
    expect(imageFromClipboard([], [file('text/plain')])).toBeUndefined();
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

describe('fileFromBase64', () => {
  it('turns base64 back into a file of the given type and size', () => {
    const f = fileFromBase64(btoa('abc'), 'image/png', 'clip.png');
    expect(f.type).toBe('image/png');
    expect(f.name).toBe('clip.png');
    expect(f.size).toBe(3);
  });
});

describe('plainPreview', () => {
  it('drops Markdown marks so a card reads as plain words', () => {
    expect(plainPreview('# The key\n\n**Beware** the _crypt_.\n> read aloud\n- one\n- two')).toBe(
      'The key Beware the crypt. read aloud one two',
    );
  });
  it('keeps ordinary punctuation and collapses blank space', () => {
    expect(plainPreview('  Meet me at dusk -  bring 3 torches.  ')).toBe(
      'Meet me at dusk - bring 3 torches.',
    );
  });
});

describe('canCreateHandout', () => {
  const base = { title: 'Crypt', text: '', pictures: 0, hasPdf: false };
  it('needs a title, then the right content for the kind', () => {
    expect(canCreateHandout({ ...base, mode: 'note', text: 'Hello' })).toBe(true);
    expect(canCreateHandout({ ...base, mode: 'note', text: '   ' })).toBe(false);
    expect(canCreateHandout({ ...base, mode: 'pictures', pictures: 2 })).toBe(true);
    expect(canCreateHandout({ ...base, mode: 'pictures', pictures: 0 })).toBe(false);
    expect(canCreateHandout({ ...base, mode: 'pdf', hasPdf: true })).toBe(true);
    expect(canCreateHandout({ ...base, mode: 'pdf', title: ' ', hasPdf: true })).toBe(false);
  });
  it('allows at most twelve pictures', () => {
    expect(canCreateHandout({ ...base, mode: 'pictures', pictures: 12 })).toBe(true);
    expect(canCreateHandout({ ...base, mode: 'pictures', pictures: 13 })).toBe(false);
    expect(MAX_PICTURES).toBe(12);
  });
});
