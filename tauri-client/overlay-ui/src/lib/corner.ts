export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const CORNER_STORAGE_KEY = 'vtt-overlay-corner';
export const DEFAULT_CORNER: Corner = 'top-left';

const VALID_CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function isCorner(value: string): value is Corner {
  return (VALID_CORNERS as readonly string[]).includes(value);
}

/**
 * Read once at mount (`main.tsx`), before React renders — corner position is deliberately not
 * reactive within a window's lifetime. See the compact-view redesign spec's "Corner
 * Positioning" section: changing it updates `localStorage` for *future* loads only; a window
 * already open does not jump to the new corner.
 */
export function getCorner(): Corner {
  try {
    const stored = localStorage.getItem(CORNER_STORAGE_KEY);
    if (stored !== null && isCorner(stored)) return stored;
  } catch {
    // localStorage unavailable (e.g. disabled by the user) — fall through to the default.
  }
  return DEFAULT_CORNER;
}

export function setCorner(corner: Corner): void {
  try {
    localStorage.setItem(CORNER_STORAGE_KEY, corner);
  } catch {
    // localStorage unavailable — nothing to persist to. The picker's own UI still reflects the
    // in-memory selection until the page reloads.
  }
}

/** CSS fragment anchoring `position: fixed` content to the given corner. */
export function cornerStyle(corner: Corner): string {
  const vertical = corner.startsWith('top') ? 'top: 0 !important' : 'bottom: 0 !important';
  const horizontal = corner.endsWith('left') ? 'left: 0 !important' : 'right: 0 !important';
  return `${vertical}; ${horizontal}`;
}
