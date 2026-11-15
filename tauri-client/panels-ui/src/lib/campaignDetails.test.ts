import { describe, expect, it } from 'vitest';

import { characterCount, validateDetails } from './campaignDetails.js';

describe('validateDetails', () => {
  it('needs a name of 1 to 120 characters once trimmed', () => {
    expect(validateDetails('Strahd', '').ok).toBe(true);
    expect(validateDetails('   ', '').ok).toBe(false);
    expect(validateDetails('x'.repeat(120), '').ok).toBe(true);
    expect(validateDetails('x'.repeat(121), '').ok).toBe(false);
  });

  it('allows a description of up to 4,000 characters, counting an emoji as one', () => {
    expect(validateDetails('A', '🐉'.repeat(4000)).ok).toBe(true);
    expect(validateDetails('A', '🐉'.repeat(4001)).ok).toBe(false);
    expect(validateDetails('A', 'x'.repeat(4001))).toMatchObject({ ok: false });
    expect(characterCount('🐉🐉')).toBe(2);
  });
});
