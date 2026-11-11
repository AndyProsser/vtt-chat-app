import { describe, expect, it } from 'vitest';

import { handoffUrl, stripTokenFromUrl, tokenFromHash } from './handoff.js';

describe('handoff', () => {
  it('builds a fragment URL, never a query string', () => {
    const url = handoffUrl('a b/c+d');
    expect(url).toBe('/app#connect=a%20b%2Fc%2Bd');
    expect(url).not.toContain('?');
  });
  it('round-trips through the parser', () => {
    expect(tokenFromHash(handoffUrl('Tok_en-1/+=')?.slice('/app'.length))).toBe('Tok_en-1/+=');
  });
  it('parses with or without the # and ignores other parts', () => {
    expect(tokenFromHash('#connect=abc')).toBe('abc');
    expect(tokenFromHash('connect=abc')).toBe('abc');
    expect(tokenFromHash('#x=1&connect=abc')).toBe('abc');
  });
  it('returns undefined for missing, empty or malformed tokens', () => {
    expect(tokenFromHash('')).toBeUndefined();
    expect(tokenFromHash('#chat')).toBeUndefined();
    expect(tokenFromHash('#connect=')).toBeUndefined();
    expect(tokenFromHash('#connect=%E0%A4%A')).toBeUndefined();
    expect(tokenFromHash('#xconnect=abc')).toBeUndefined();
  });
  it('strips the token and keeps path, query and other fragment parts', () => {
    expect(stripTokenFromUrl('/app', '', '#connect=abc')).toBe('/app');
    expect(stripTokenFromUrl('/app', '?a=1', '#connect=abc&x=1')).toBe('/app?a=1#x=1');
    expect(stripTokenFromUrl('/app', '', '')).toBe('/app');
  });
});
