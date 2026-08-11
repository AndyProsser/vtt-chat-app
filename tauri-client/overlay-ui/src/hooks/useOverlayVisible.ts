import { useOverlayVisibilityStore } from '../lib/overlayVisibilityStore.js';

/** Single-primitive selector for leaf components — see docs/architecture/STATE-AND-RESILIENCE.md. */
export function useOverlayVisible(): boolean {
  return useOverlayVisibilityStore((state) => state.visible);
}
