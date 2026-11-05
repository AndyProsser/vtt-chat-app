import { useLiveKitStore } from '../lib/store.js';

/** Single-primitive selector for leaf components — see docs/architecture/STATE-AND-RESILIENCE.md. */
export function useConnected(): boolean {
  return useLiveKitStore((state) => state.connected);
}
