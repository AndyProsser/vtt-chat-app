import { create } from 'zustand';

import type { ReadingPrefs } from '../types/languageFont.js';

export const READING_KEY = 'vtt.reading';

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  languageFonts: true,
  documentFonts: true,
  forceReadable: false,
};

const FIELDS = Object.keys(DEFAULT_READING_PREFS) as (keyof ReadingPrefs)[];

/** Stored text to prefs: a field that is missing or of the wrong type keeps its default; nothing here throws. */
export function parseReadingPrefs(raw: string | null): ReadingPrefs {
  const prefs = { ...DEFAULT_READING_PREFS };
  if (!raw) return prefs;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return prefs;
  }
  if (typeof parsed !== 'object' || parsed === null) return prefs;
  for (const field of FIELDS) {
    const value = (parsed as Record<string, unknown>)[field];
    if (typeof value === 'boolean') prefs[field] = value;
  }
  return prefs;
}

/**
 * Puts the prefs on the page: `data-readable="on"` and `data-doc-fonts="off"` make the stylesheet swap the narrative
 * face for the body face (tokens.css). Language fonts are not a stylesheet matter; they are read where a line is drawn.
 */
export function applyReadingPrefs(
  prefs: ReadingPrefs,
  root: HTMLElement = document.documentElement,
): void {
  if (prefs.forceReadable) root.dataset.readable = 'on';
  else delete root.dataset.readable;
  if (prefs.documentFonts) delete root.dataset.docFonts;
  else root.dataset.docFonts = 'off';
}

function read(): ReadingPrefs {
  try {
    return parseReadingPrefs(localStorage.getItem(READING_KEY));
  } catch {
    return { ...DEFAULT_READING_PREFS }; // storage blocked: a per-device convenience, never a failure
  }
}

interface ReadingPrefsStore extends ReadingPrefs {
  set: (patch: Partial<ReadingPrefs>) => void;
}

export const useReadingPrefsStore = create<ReadingPrefsStore>((setState, get) => ({
  ...read(),
  set: (patch) => {
    const current = get();
    const next: ReadingPrefs = {
      languageFonts: patch.languageFonts ?? current.languageFonts,
      documentFonts: patch.documentFonts ?? current.documentFonts,
      forceReadable: patch.forceReadable ?? current.forceReadable,
    };
    if (FIELDS.every((f) => next[f] === current[f])) return; // no-op guard: nothing re-renders
    applyReadingPrefs(next);
    try {
      localStorage.setItem(READING_KEY, JSON.stringify(next));
    } catch {
      /* not persisted; still applied for this session */
    }
    setState(next);
  },
}));

/** Applies the stored (or default) prefs to the page; call once before the first render. */
export function applyStoredReadingPrefs(): void {
  const prefs = read();
  useReadingPrefsStore.setState(prefs);
  applyReadingPrefs(prefs);
}

/**
 * Every window is its own webview but they share storage, so a switch flipped in Settings reaches the main window
 * (and any other open window or tab) through the `storage` event, with no reload.
 */
export function followReadingPrefsFromOtherWindows(): () => void {
  const on = (e: StorageEvent) => {
    if (e.key !== READING_KEY) return;
    const prefs = parseReadingPrefs(e.newValue);
    applyReadingPrefs(prefs);
    useReadingPrefsStore.setState(prefs);
  };
  window.addEventListener('storage', on);
  return () => window.removeEventListener('storage', on);
}
