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

const PAGE_MODE_CHANGE_EVENT = 'vtt-page-mode-check';
let historyPatched = false;

function patchHistoryOnce(): void {
  if (historyPatched) return;
  historyPatched = true;

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (
      this: History,
      ...args: Parameters<History[typeof method]>
    ): ReturnType<History[typeof method]> {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(PAGE_MODE_CHANGE_EVENT));
      return result;
    };
  }
}

/**
 * Fires `listener` on `popstate` and on patched `pushState`/`replaceState`, covering both a
 * hard navigation and DDB routing client-side. Whether DDB actually needs the patched-history
 * half is unconfirmed (see the Stage 3a design's "Open questions") — the mechanism is small and
 * correct either way, so it's built rather than gambled on.
 */
export function subscribeToPageModeChanges(listener: () => void): () => void {
  patchHistoryOnce();
  window.addEventListener('popstate', listener);
  window.addEventListener(PAGE_MODE_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(PAGE_MODE_CHANGE_EVENT, listener);
  };
}
