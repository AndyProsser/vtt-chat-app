import { useMicrophoneStore } from '../lib/microphoneStore.js';

/** Single-primitive selector for leaf components — see docs/architecture/STATE-AND-RESILIENCE.md. */
export function useMicrophoneMuted(): boolean {
  return useMicrophoneStore((state) => state.muted);
}
