import type { LiveKitConnectionState } from '@vtt-chat-app/shared';
import { create } from 'zustand';

interface LiveKitStore extends LiveKitConnectionState {
  applyState: (state: LiveKitConnectionState) => void;
}

/**
 * The one domain store for Stage 1. Per docs/architecture/STATE-AND-RESILIENCE.md, this is a
 * cache of `rust-livekit`'s state, not a source of truth — `applyState` always replaces wholesale,
 * never merges partial updates. Components must subscribe to a single primitive field (see
 * `hooks/useConnected.ts` / `useParticipantIdentities.ts`), never the whole store object.
 */
export const useLiveKitStore = create<LiveKitStore>((set) => ({
  connected: false,
  roomName: null,
  participantIdentities: [],
  applyState: (state) => set(state),
}));
