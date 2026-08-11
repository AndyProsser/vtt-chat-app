import { useSpeakingStore } from '../lib/speakingStore.js';
import { useChurnDiagnostics } from './useChurnDiagnostics.js';

/**
 * Single-primitive selector for leaf components — see docs/architecture/STATE-AND-RESILIENCE.md.
 * A participant re-renders only when their own speaking state flips, never when someone else's
 * does, because the selector reads one boolean out of the shared `Set`.
 */
export function useIsSpeaking(identity: string): boolean {
  useChurnDiagnostics(`isSpeaking:${identity}`);
  return useSpeakingStore((state) => state.speakingIdentities.has(identity));
}
