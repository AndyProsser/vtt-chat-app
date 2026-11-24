import { CHAT_LANGUAGES, type ChatLanguage } from '@vtt-chat-app/shared';
import { describe, expect, it } from 'vitest';

import { LANGUAGE_FONTS, STYLE_FALLBACK_CSS } from '../consts/languageFonts.js';
import { languageTextStyle, styleFor } from './languageTextStyle.js';

describe('the language font table', () => {
  it('has a font for every language in CHAT_LANGUAGES except common', () => {
    const missing = CHAT_LANGUAGES.filter(
      (l) => l.key !== 'common' && LANGUAGE_FONTS[l.key] === undefined,
    ).map((l) => l.key);
    expect(missing).toEqual([]);
  });

  it('has no entry for a language the wire does not know', () => {
    const keys = new Set(CHAT_LANGUAGES.map((l) => l.key));
    expect(Object.keys(LANGUAGE_FONTS).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('gives no two languages the same font and style', () => {
    const seen = new Map<string, string>();
    for (const [key, f] of Object.entries(LANGUAGE_FONTS)) {
      const sig = `${f.family}|${f.weight}|${f.italic ? 'i' : 'n'}`;
      expect(seen.get(sig), `${key} repeats ${seen.get(sig)}`).toBeUndefined();
      seen.set(sig, key);
    }
  });
});

describe('languageTextStyle', () => {
  it('sets elvish in Cormorant Garamond italic 500', () => {
    const s = languageTextStyle('elvish');
    expect(s?.fontFamily).toMatch(/^"Cormorant Garamond"/);
    expect(s?.fontStyle).toBe('italic');
    expect(s?.fontWeight).toBe('500');
  });

  it('sets dwarvish in Alegreya SC', () => {
    expect(languageTextStyle('dwarvish')?.fontFamily).toMatch(/^"Alegreya SC"/);
  });

  it('sets celestial in Cinzel Decorative 700, as the typography doc decided', () => {
    const s = languageTextStyle('celestial');
    expect(s?.fontFamily).toMatch(/^"Cinzel Decorative"/);
    expect(s?.fontWeight).toBe('700');
  });

  it('sets giant in Uncial Antiqua, as the typography doc decided', () => {
    expect(languageTextStyle('giant')?.fontFamily).toMatch(/^"Uncial Antiqua"/);
  });

  it('sets thieves-cant in italic Inter, so it looks like everyday text', () => {
    const s = languageTextStyle('thieves-cant');
    expect(s?.fontFamily).toMatch(/^"Inter Variable"/);
    expect(s?.fontStyle).toBe('italic');
  });

  it.each([
    ['draconic', 'Pirata One', 'menace and power'],
    ['undercommon', 'Spirax', 'otherworldly and strange, still readable'],
    ['druidic', 'Merienda', 'free, flowing, forest'],
    ['gnomish', 'Special Elite', 'an engineer or mad scientist'],
    ['halfling', 'Patrick Hand', 'small, lively and curious'],
  ])('sets %s in %s (Andy, 2026-11-24: %s)', (key, family) => {
    expect(languageTextStyle(key)?.fontFamily).toMatch(new RegExp(`^"${family}"`));
  });

  it('returns undefined for no key or an unknown one', () => {
    expect(languageTextStyle(undefined)).toBeUndefined();
    expect(languageTextStyle('klingon')).toBeUndefined();
  });

  it('returns an empty style for common', () => {
    expect(languageTextStyle('common')).toEqual({});
  });

  it('returns an empty style when language fonts are switched off', () => {
    expect(languageTextStyle('elvish', { languageFonts: false, forceReadable: false })).toEqual({});
  });

  it('returns an empty style in force readable mode, even with language fonts on', () => {
    expect(languageTextStyle('elvish', { languageFonts: true, forceReadable: true })).toEqual({});
  });
});

describe('styleFor', () => {
  it('falls back to the wire style for a key it has no font for', () => {
    const kobold: ChatLanguage = { key: 'kobold', name: 'Kobold', style: 'angular', aliases: [] };
    expect(styleFor(kobold, {})).toEqual(STYLE_FALLBACK_CSS.angular);
  });

  it('never throws for any style a newer server might send', () => {
    const odd = { key: 'x', name: 'X', style: 'wobbly', aliases: [] } as unknown as ChatLanguage;
    expect(() => styleFor(odd, {})).not.toThrow();
    expect(styleFor(odd, {})).toEqual({});
  });
});

describe('when a font file fails to load', () => {
  it('leaves every language a generic family to fall back to, so the text still reads', () => {
    for (const [key, f] of Object.entries(LANGUAGE_FONTS)) {
      expect(f.fallback, key).toMatch(/(serif|sans-serif|monospace|cursive)$/);
      expect(languageTextStyle(key)?.fontFamily, key).toMatch(
        /(serif|sans-serif|monospace|cursive)$/,
      );
    }
  });
});
