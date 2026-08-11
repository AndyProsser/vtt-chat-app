export type OverlayMode = 'full' | 'pill';

const MAPS_PATH_PATTERN = /^\/games\/[^/]+/;

/**
 * `localStorage` key for CLAUDE.md §9's "overlay everywhere" debug mode. A `localStorage` flag
 * rather than a Tauri command: a debug toggle shouldn't need a shell round-trip or an IPC
 * surface that ships to users. See the Stage 3a design §1.
 */
export const OVERLAY_EVERYWHERE_STORAGE_KEY = 'vtt-overlay-everywhere';

function isOverlayEverywhereEnabled(): boolean {
  try {
    return localStorage.getItem(OVERLAY_EVERYWHERE_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Classifies a page as `full` (Maps VTT — roster, speaking indicators, mute, later chat) or
 * `pill` (any other allowed DDB page — mic state + mute only). The `/games/<id>` pattern is
 * taken from the Stage 3 known-issue note in ROADMAP.md, recorded from a real Maps VTT page —
 * it is not inferred from DDB internals (CLAUDE.md §14), and implementation verifies it against
 * a real Maps load before this stage closes (see the design's "Manual verification").
 */
export function classifyPage(url: URL): OverlayMode {
  if (isOverlayEverywhereEnabled()) return 'full';
  return MAPS_PATH_PATTERN.test(url.pathname) ? 'full' : 'pill';
}
