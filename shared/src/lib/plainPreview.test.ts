import { describe, expect, it } from 'vitest';

import { plainPreview } from './plainPreview.js';

describe('plainPreview', () => {
  it('drops Markdown marks so a preview reads as plain words', () => {
    expect(plainPreview('# The key\n\n**Beware** the _crypt_.\n> read aloud\n- one\n- two')).toBe(
      'The key Beware the crypt. read aloud one two',
    );
  });
  it('reads a quoted verse in italics as its words', () => {
    expect(plainPreview('> *The king keeps what he was given.*\n> *Who would enter pays.*')).toBe(
      'The king keeps what he was given. Who would enter pays.',
    );
  });
});
