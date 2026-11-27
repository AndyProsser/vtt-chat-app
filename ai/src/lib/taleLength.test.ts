import { describe, expect, it } from 'vitest';

import { trimTaleToWords } from './taleLength.js';

const words = (text: string): number => text.split(/\s+/).filter((w) => w !== '').length;

describe('trimTaleToWords', () => {
  it('leaves a tale that is within its limit alone', () => {
    const tale = 'Aria opened the door. A cold wind answered.';
    expect(trimTaleToWords(tale, 20)).toBe(tale);
  });

  it('cuts a runaway tale back to whole sentences within the limit', () => {
    const sentence = 'The hero walked on through the long and winding night.'; // 10 words
    const tale = Array.from({ length: 20 }, () => sentence).join(' '); // 200 words
    const out = trimTaleToWords(tale, 35);
    expect(words(out)).toBeLessThanOrEqual(35);
    expect(out.endsWith('.')).toBe(true);
    expect(out.startsWith(sentence)).toBe(true);
  });

  it('keeps the title heading and does not count it', () => {
    const tale =
      '# The Weeping Anchor\n\nAria opened the door. A cold wind answered. Nothing else came.';
    const out = trimTaleToWords(tale, 8);
    expect(out.startsWith('# The Weeping Anchor\n\n')).toBe(true);
    expect(out).toContain('Aria opened the door.');
    expect(out).not.toContain('Nothing else came.');
  });

  it('always keeps the first sentence, even when it alone is over the limit', () => {
    const tale = 'One very long opening sentence that runs past the limit. And then more.';
    expect(trimTaleToWords(tale, 3)).toBe(
      'One very long opening sentence that runs past the limit.',
    );
  });

  it('keeps paragraph breaks between the sentences it keeps', () => {
    const tale =
      'First came the rain.\n\nThen came the thunder. Then came the dark. Then came the dawn.';
    const out = trimTaleToWords(tale, 9);
    expect(out).toBe('First came the rain.\n\nThen came the thunder.');
  });
});
