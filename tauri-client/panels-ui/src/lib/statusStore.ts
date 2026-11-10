import { create } from 'zustand';

export type Status = 'online' | 'away' | 'offline';

interface StatusStore {
  status: Status;
  applyStatus: (status: Status) => void;
}

/**
 * The player's own status, mirroring the Rust core's `status:changed` event. Every launch starts Offline:
 * the app never joins voice by itself. A no-op when unchanged, so repeated events wake nobody.
 */
export const useStatusStore = create<StatusStore>((set) => ({
  status: 'offline',
  applyStatus: (status) => set((state) => (state.status === status ? state : { status })),
}));
