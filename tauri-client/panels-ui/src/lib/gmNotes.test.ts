import { describe, expect, it } from 'vitest';

import { aliasesText, parseAliases } from './gmNotes.js';

describe('aliases', () => {
  it('splits and joins aliases', () => {
    expect(parseAliases('Gary, the gnome ,, G')).toEqual(['Gary', 'the gnome', 'G']);
    expect(aliasesText(['a', 'b'])).toBe('a, b');
  });
});
