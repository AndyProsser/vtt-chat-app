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
  it('is the caption of a picture set or PDF too', () => {
    expect(handoutExcerpt('image', ' The ward on the north wall. ')).toBe(
      'The ward on the north wall.',
    );
    expect(handoutExcerpt('pdf', 'Page 3 matters.')).toBe('Page 3 matters.');
  });
  it('is nothing when there is no text, or only blanks', () => {
    expect(handoutExcerpt('image', null)).toBeUndefined();
    expect(handoutExcerpt('map', undefined)).toBeUndefined();
    expect(handoutExcerpt('text', '   ')).toBeUndefined();
  });
});
