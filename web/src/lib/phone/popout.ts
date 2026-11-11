/**
 * The members popout's open/close rules, as a pure reducer so they can be tested without a browser.
 *
 * - A mouse hovering an avatar opens its popout after a short delay and closes it a moment after leaving
 *   (the gap lets the pointer travel from the avatar into the popout).
 * - A click or tap opens it "pinned": it stays until the next click, Escape, or an outside press.
 *   A click on a popout that hover opened pins it instead of closing it.
 * - Only one popout is open at a time (`open` is a single id).
 * The component runs a timer while `pending` is set and sends `timer` when it fires.
 */
export const OPEN_DELAY_MS = 250;
export const CLOSE_DELAY_MS = 150;

export interface PopoutState {
  open: string | null;
  /** Opened by click/tap/keyboard, so leaving with the mouse does not close it. */
  pinned: boolean;
  pending: { id: string; to: 'open' | 'close' } | null;
}

export type PopoutEvent =
  | { type: 'enter'; id: string }
  | { type: 'leave'; id: string }
  | { type: 'click'; id: string }
  | { type: 'timer' }
  | { type: 'dismiss' };

export const POPOUT_CLOSED: PopoutState = { open: null, pinned: false, pending: null };

export function popoutReducer(s: PopoutState, e: PopoutEvent): PopoutState {
  switch (e.type) {
    case 'enter':
      if (s.open === e.id) return s.pending ? { ...s, pending: null } : s;
      return { ...s, pending: { id: e.id, to: 'open' } };
    case 'leave':
      if (s.pending?.id === e.id && s.pending.to === 'open') return { ...s, pending: null };
      if (s.open === e.id && !s.pinned) return { ...s, pending: { id: e.id, to: 'close' } };
      return s;
    case 'click':
      if (s.open === e.id && s.pinned) return POPOUT_CLOSED;
      return { open: e.id, pinned: true, pending: null };
    case 'timer': {
      const p = s.pending;
      if (!p) return s;
      return p.to === 'open' ? { open: p.id, pinned: false, pending: null } : POPOUT_CLOSED;
    }
    case 'dismiss':
      return s.open === null && s.pending === null ? s : POPOUT_CLOSED;
  }
}

/** The delay to wait for the pending change, if any. */
export const pendingDelay = (s: PopoutState): number | undefined =>
  s.pending ? (s.pending.to === 'open' ? OPEN_DELAY_MS : CLOSE_DELAY_MS) : undefined;
