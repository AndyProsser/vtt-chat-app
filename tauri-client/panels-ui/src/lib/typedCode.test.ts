import { describe, expect, it } from 'vitest';

import { isTypeableCode } from './typedCode.js';

describe('isTypeableCode', () => {
  it('shows short codes and hides long link tokens', () => {
    expect(isTypeableCode('')).toBe(true);
    expect(isTypeableCode('ABCD-2345')).toBe(true);
    expect(isTypeableCode('Zm9vYmFyLV9iYXo0NTY3ODkwQUJDREVGR0hJSktMTU4')).toBe(false);
  });
});
