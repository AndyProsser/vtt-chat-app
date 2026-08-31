import { create } from 'zustand';

interface ExpandStore {
  expanded: boolean;
  toggle: () => void;
}

/**
 * UI-only state, per-instance by construction (each window/page runs its own separately
 * injected overlay, via `initialization_script`), matching `overlayVisibilityStore`'s
 * reasoning — a local view preference, not a cache of any backend truth. Deliberately not
 * persisted: always resets to collapsed on a fresh mount/refresh/navigation, so critical info
 * is never hidden behind a state nobody remembers setting. See the compact-view redesign
 * spec's "Expand / Collapse" section.
 */
export const useExpandStore = create<ExpandStore>((set) => ({
  expanded: false,
  toggle: () => set((state) => ({ expanded: !state.expanded })),
}));
