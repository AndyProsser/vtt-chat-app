import { afterEach, describe, expect, it, vi } from 'vitest';

import { contrastRatio } from './contrast.js';
import { DEFAULT_THEME, resolveTheme, THEMES, themeCss } from './themes.js';
import { followThemeChangesFromOtherWindows, useThemeStore } from './themeStore.js';

describe('themes', () => {
  it('ships the launch themes, the colourful Default first', () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      'default',
      'dragonfire',
      'arcane',
      'dungeon',
      'verdant',
      'frostbound',
    ]);
    expect(DEFAULT_THEME).toBe('default');
  });

  for (const theme of THEMES) {
    for (const variant of ['dark', 'light'] as const) {
      it(`${theme.id} ${variant}: text is readable on every surface`, () => {
        const p = theme[variant];
        for (const surface of [p.bg, p.bar, p.bubble, p.whisper, p.dmMsg, p.chat]) {
          expect(contrastRatio(p.ink, surface)).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrastRatio(p.gold, p.bar)).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it('falls back to the Default theme for an unknown, empty or missing id', () => {
    expect(resolveTheme('nope')).toBe('default');
    expect(resolveTheme(null)).toBe('default');
    expect(resolveTheme(undefined)).toBe('default');
    expect(resolveTheme('arcane')).toBe('arcane');
  });

  it('generates a light block and a prefers-color-scheme dark block per theme', () => {
    const css = themeCss();
    for (const t of THEMES) expect(css).toContain(`:root[data-theme="${t.id}"]`);
    expect(css.match(/prefers-color-scheme: dark/g)?.length).toBe(THEMES.length);
    expect(css).toContain('--vtt-whisper-edge');
  });
});

describe('theme store', () => {
  afterEach(() => vi.restoreAllMocks());

  it('applies the theme to the document', () => {
    useThemeStore.getState().setTheme('arcane');
    expect(document.documentElement.dataset.theme).toBe('arcane');
  });

  it('still applies the theme when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => useThemeStore.getState().setTheme('verdant')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('verdant');
  });
});

describe('theme sync between windows', () => {
  it('applies a theme another window saved, and ignores unrelated keys', () => {
    const stop = followThemeChangesFromOtherWindows();
    window.dispatchEvent(new StorageEvent('storage', { key: 'vtt.theme', newValue: 'frostbound' }));
    expect(document.documentElement.dataset.theme).toBe('frostbound');
    expect(useThemeStore.getState().themeId).toBe('frostbound');
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'arcane' }));
    expect(document.documentElement.dataset.theme).toBe('frostbound');
    window.dispatchEvent(new StorageEvent('storage', { key: 'vtt.theme', newValue: 'garbage' }));
    expect(document.documentElement.dataset.theme).toBe('default');
    stop();
  });
});
