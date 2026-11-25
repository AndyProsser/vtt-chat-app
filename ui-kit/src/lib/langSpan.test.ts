import { describe, expect, it } from 'vitest';

import { langFromFence, langUrlTransform, parseLangHref } from './langSpan.js';

describe('parseLangHref', () => {
  it('reads the language from a lang: link', () => {
    expect(parseLangHref('lang:dwarvish')).toBe('dwarvish');
    expect(parseLangHref('lang:deep-speech')).toBe('deep-speech');
    expect(parseLangHref('lang:thieves-cant')).toBe('thieves-cant');
  });

  it('accepts the aliases chat accepts, in any case, and gives back the real key', () => {
    expect(parseLangHref('lang:Dwarven')).toBe('dwarvish');
    expect(parseLangHref('LANG:elf')).toBe('elvish');
    expect(parseLangHref('lang:thievescant')).toBe('thieves-cant');
  });

  it('is nothing for common, an unknown language, an empty name or any other link', () => {
    expect(parseLangHref('lang:common')).toBeUndefined();
    expect(parseLangHref('lang:klingon')).toBeUndefined();
    expect(parseLangHref('lang:')).toBeUndefined();
    expect(parseLangHref('https://example.com/lang:elvish')).toBeUndefined();
    expect(parseLangHref('#dwarvish')).toBeUndefined();
    expect(parseLangHref(undefined)).toBeUndefined();
  });
});

describe('langUrlTransform', () => {
  it('lets a lang: link through, which the default filter would blank', () => {
    expect(langUrlTransform('lang:elvish')).toBe('lang:elvish');
  });

  it('still blanks an unsafe address and keeps a safe one', () => {
    expect(langUrlTransform('javascript:alert(1)')).toBe('');
    expect(langUrlTransform('https://example.com/a')).toBe('https://example.com/a');
  });
});

describe('langFromFence', () => {
  it('reads the language from a fenced block’s class', () => {
    expect(langFromFence('language-dwarvish')).toBe('dwarvish');
    expect(langFromFence('x language-Elven y')).toBe('elvish');
  });

  it('leaves an ordinary code block alone', () => {
    expect(langFromFence('language-ts')).toBeUndefined();
    expect(langFromFence('language-common')).toBeUndefined();
    expect(langFromFence(undefined)).toBeUndefined();
    expect(langFromFence('')).toBeUndefined();
  });
});
