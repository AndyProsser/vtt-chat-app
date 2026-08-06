import { useLiveKitStore } from '../lib/store.js';

/** Single-primitive selector for leaf components — see docs/architecture/STATE-AND-RESILIENCE.md. */
export function useParticipantIdentities(): string[] {
  return useLiveKitStore((state) => state.participantIdentities);
}
