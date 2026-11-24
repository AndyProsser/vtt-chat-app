// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_READING_PREFS,
  READING_KEY,
  applyReadingPrefs,
  applyStoredReadingPrefs,
  followReadingPrefsFromOtherWindows,
  parseReadingPrefs,
  useReadingPrefsStore,
} from './readingPrefs.js';

beforeEach(() => {
  localStorage.clear();
  useReadingPrefsStore.setState({ ...DEFAULT_READING_PREFS });
  document.documentElement.removeAttribute('data-readable');
  document.documentElement.removeAttribute('data-doc-fonts');
});
afterEach(() => vi.unstubAllGlobals());

describe('parseReadingPrefs', () => {
  it('is the defaults for nothing stored', () => {
    expect(parseReadingPrefs(null)).toEqual(DEFAULT_READING_PREFS);
  });

  it('is the defaults for text that is not JSON', () => {
    expect(parseReadingPrefs('{nope')).toEqual(DEFAULT_READING_PREFS);
    expect(parseReadingPrefs('42')).toEqual(DEFAULT_READING_PREFS);
  });

  it('ignores a field of the wrong type and keeps its default', () => {
    expect(parseReadingPrefs('{"languageFonts":"yes"}')).toEqual(DEFAULT_READING_PREFS);
  });

  it('keeps the other fields at their defaults when only one is stored', () => {
    expect(parseReadingPrefs('{"forceReadable":true}')).toEqual({
      languageFonts: true,
      documentFonts: true,
      forceReadable: true,
    });
  });

  it('keeps the valid fields beside an invalid one', () => {
    expect(parseReadingPrefs('{"languageFonts":"yes","documentFonts":false}')).toEqual({
      languageFonts: true,
      documentFonts: false,
      forceReadable: false,
    });
  });
});

describe('the reading prefs store', () => {
  it('persists a change', () => {
    useReadingPrefsStore.getState().set({ forceReadable: true });
    expect(JSON.parse(localStorage.getItem(READING_KEY) ?? '{}')).toMatchObject({
      forceReadable: true,
    });
  });

  it('applies a change to the document at once', () => {
    useReadingPrefsStore.getState().set({ forceReadable: true });
    expect(document.documentElement.dataset.readable).toBe('on');
    useReadingPrefsStore.getState().set({ documentFonts: false });
    expect(document.documentElement.dataset.docFonts).toBe('off');
  });

  it('does not notify subscribers when nothing changed', () => {
    const seen = vi.fn();
    const stop = useReadingPrefsStore.subscribe(seen);
    useReadingPrefsStore.getState().set({ languageFonts: true });
    stop();
    expect(seen).not.toHaveBeenCalled();
  });

  it('keeps working in memory when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => useReadingPrefsStore.getState().set({ languageFonts: false })).not.toThrow();
    expect(useReadingPrefsStore.getState().languageFonts).toBe(false);
  });

  it('applies the stored prefs at start-up', () => {
    localStorage.setItem(READING_KEY, '{"forceReadable":true}');
    applyStoredReadingPrefs();
    expect(document.documentElement.dataset.readable).toBe('on');
    expect(useReadingPrefsStore.getState().forceReadable).toBe(true);
  });

  it('follows a change made in another window', () => {
    const stop = followReadingPrefsFromOtherWindows();
    window.dispatchEvent(
      new StorageEvent('storage', { key: READING_KEY, newValue: '{"documentFonts":false}' }),
    );
    stop();
    expect(useReadingPrefsStore.getState().documentFonts).toBe(false);
    expect(document.documentElement.dataset.docFonts).toBe('off');
  });

  it('ignores a storage change for some other key', () => {
    const stop = followReadingPrefsFromOtherWindows();
    window.dispatchEvent(new StorageEvent('storage', { key: 'vtt.theme', newValue: 'x' }));
    stop();
    expect(useReadingPrefsStore.getState().documentFonts).toBe(true);
  });
});

describe('applyReadingPrefs', () => {
  it('turns the narrative face off for force readable and for document fonts off', () => {
    const root = document.createElement('html');
    applyReadingPrefs({ languageFonts: true, documentFonts: true, forceReadable: true }, root);
    expect(root.dataset.readable).toBe('on');
    applyReadingPrefs({ languageFonts: true, documentFonts: false, forceReadable: false }, root);
    expect(root.dataset.readable).toBeUndefined();
    expect(root.dataset.docFonts).toBe('off');
  });
});
