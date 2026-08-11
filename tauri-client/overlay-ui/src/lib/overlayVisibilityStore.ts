import { create } from 'zustand';

interface OverlayVisibilityStore {
  visible: boolean;
  toggle: () => void;
}

/**
 * UI-only state, deliberately separate from `useLiveKitStore`.
 *
 * Per docs/architecture/STATE-AND-RESILIENCE.md (Stage 0.5), domain state — anything that is a
 * cache of `rust-livekit`'s truth — and UI-only state must not share a store. "Is the overlay
 * panel showing" is a local view preference: it survives no reconnect, needs no recovery, and
 * must not be clobbered when a `livekit:state` event replaces domain state wholesale.
 *
 * Toggled by the `overlay:toggle` Tauri event (Ctrl+Shift+O), via `useOverlayVisibility`.
 */
export const useOverlayVisibilityStore = create<OverlayVisibilityStore>((set) => ({
  visible: true,
  toggle: () => set((state) => ({ visible: !state.visible })),
}));
