import { describe, expect, it } from 'vitest';

import { EXCERPT_CHARS, handoutExcerpt } from './handoutExcerpt.js';

describe('handoutExcerpt', () => {
  it('is the text of a note, trimmed', () => {
    expect(handoutExcerpt('text', '  Speak friend.  ')).toBe('Speak friend.');
  });
  it('is cut at a word near the limit with an ellipsis, so the chat card stays small', () => {
    const long = 'word '.repeat(300);
    const out = handoutExcerpt('text', long) ?? '';
    expect(out.length).toBeLessThanOrEqual(EXCERPT_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
    expect(out.endsWith(' …')).toBe(false);
  });
  it('is nothing for a picture, a map, a PDF or an empty note', () => {
    expect(handoutExcerpt('image', 'ignored')).toBeUndefined();
    expect(handoutExcerpt('map', null)).toBeUndefined();
    expect(handoutExcerpt('pdf', 'x')).toBeUndefined();
    expect(handoutExcerpt('text', '   ')).toBeUndefined();
  });
});
