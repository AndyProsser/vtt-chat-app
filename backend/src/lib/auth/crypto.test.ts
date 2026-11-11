import { describe, expect, it } from 'vitest';

import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from '../../consts/index.js';
import { generateShortCode, normaliseShortCode } from './crypto.js';

describe('short codes', () => {
  it('are 8 characters from the speakable alphabet', () => {
    const code = generateShortCode();
    expect(code).toHaveLength(SHORT_CODE_LENGTH);
    for (const ch of code) expect(SHORT_CODE_ALPHABET).toContain(ch);
  });

  it('are random', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateShortCode()));
    expect(codes.size).toBeGreaterThan(1);
  });

  it('normalise case, hyphens and whitespace', () => {
    expect(normaliseShortCode(' abcd-2345 ')).toBe('ABCD2345');
  });
});
