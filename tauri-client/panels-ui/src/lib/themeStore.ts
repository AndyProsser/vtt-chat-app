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
