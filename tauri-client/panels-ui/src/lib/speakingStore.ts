import { create } from 'zustand';

interface SpeakingStore {
  speakingIdentities: Set<string>;
  applySpeakers: (identities: string[]) => void;
}

function setsAreEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/**
 * Domain state — a cache of `rust-livekit`'s active-speaker set, mirroring the `livekit:speakers`
 * event. Kept out of `useLiveKitStore` because it changes several times per second: folding it in
 * would replace the participant roster on every utterance, invalidating every selector watching
 * it — see docs/architecture/STATE-AND-RESILIENCE.md#why-this-differs-from-the-prior-system.
 *
 * `applySpeakers` replaces wholesale (the event carries the full set, never a delta) and
 * no-op-guards on set equality, per §Write Discipline. No stale-entry accumulation is possible:
 * a participant who stops speaking is simply absent from the next full set.
 */
export const useSpeakingStore = create<SpeakingStore>((set) => ({
  speakingIdentities: new Set(),
  applySpeakers: (identities) =>
    set((state) => {
      const next = new Set(identities);
      return setsAreEqual(state.speakingIdentities, next) ? state : { speakingIdentities: next };
    }),
}));
