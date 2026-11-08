import { create } from 'zustand';

import { DEFAULT_THEME, resolveTheme } from './themes.js';
import type { ThemeId } from '../types/theme.js';

const KEY = 'vtt.theme';

function read(): ThemeId {
  try {
    return resolveTheme(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_THEME; // storage blocked: a per-viewer convenience, never a failure
  }
}

function apply(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
}

interface ThemeStore {
  themeId: ThemeId;
  setTheme: (id: string) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  themeId: read(),
  setTheme: (id) => {
    const themeId = resolveTheme(id);
    apply(themeId);
    try {
      localStorage.setItem(KEY, themeId);
    } catch {
      /* not persisted; still applied for this session */
    }
    set({ themeId });
  },
}));

/** Applies the stored (or default) theme to the document; call once before the first render. */
export function applyStoredTheme(): void {
  apply(useThemeStore.getState().themeId);
}

/**
 * Every window is its own webview but they share storage, so a theme picked in Settings reaches the
 * main window (and any other open window) through the `storage` event, with no reload.
 */
export function followThemeChangesFromOtherWindows(): () => void {
  const on = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    const themeId = resolveTheme(e.newValue);
    apply(themeId);
    useThemeStore.setState({ themeId });
  };
  window.addEventListener('storage', on);
  return () => window.removeEventListener('storage', on);
}
