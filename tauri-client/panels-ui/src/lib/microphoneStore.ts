import { create } from 'zustand';

interface MicrophoneStore {
  muted: boolean;
  applyMuted: (muted: boolean) => void;
}

/**
 * Domain state — a cache of `rust-livekit`'s microphone gate, mirroring the `livekit:microphone`
 * event. Kept out of `useLiveKitStore` because it changes on every push-to-talk press: folding
 * it in would make the participant list re-render on each keypress, which is exactly the churn
 * docs/architecture/STATE-AND-RESILIENCE.md exists to prevent.
 *
 * `applyMuted` replaces wholesale and is a no-op when the value is unchanged, so the repeated
 * events both hotkey delivery paths can produce don't wake subscribers needlessly.
 */
export const useMicrophoneStore = create<MicrophoneStore>((set) => ({
  muted: true,
  applyMuted: (muted) => set((state) => (state.muted === muted ? state : { muted })),
}));
