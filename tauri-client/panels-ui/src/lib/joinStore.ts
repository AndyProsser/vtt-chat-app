import { create } from 'zustand';

import type { JoinInbox, SyncEvent } from '../types/index.js';
import {
  applyJoinRequestEvent,
  decideInbox,
  emptyInbox,
  loadInbox,
  joinDecision,
} from './joinRequests.js';
import { joinDecide, joinList } from './tauriBridge.js';

interface JoinState {
  inbox: JoinInbox;
  /** What "You're in {campaign}" or nothing: the newest answer to this person's own request. */
  decided: { campaignId: string; requestId: string; approved: boolean } | null;
  /** Reads the DM's list once (on open); live frames keep it current after that. */
  load: (campaignId: string) => Promise<void>;
  setAllow: (allowJoin: boolean) => void;
  decide: (campaignId: string, requestId: string, approve: boolean) => Promise<void>;
  apply: (event: SyncEvent) => void;
  dismissDecision: () => void;
  clearInbox: () => void;
}

/**
 * Join requests as the main window sees them: the DM's inbox (drives the cog badge and the Campaign
 * tab) and the latest answer to this person's own request. Nothing polls: a GET on load, then frames.
 */
export const useJoinStore = create<JoinState>((set, get) => ({
  inbox: emptyInbox,
  decided: null,
  load: async (campaignId) => {
    const body = await joinList(campaignId);
    set({ inbox: loadInbox(campaignId, body) });
  },
  setAllow: (allowJoin) =>
    set((s) => ({
      inbox: {
        ...s.inbox,
        allowJoin,
        requests: s.inbox.requests.map((r) => ({ ...r, closed: !allowJoin })),
      },
    })),
  decide: async (campaignId, requestId, approve) => {
    await joinDecide(campaignId, requestId, approve);
    set((s) => ({ inbox: decideInbox(s.inbox, requestId, approve) }));
  },
  apply: (event) => {
    const decision = joinDecision(event);
    if (decision) set({ decided: decision });
    const inbox = applyJoinRequestEvent(get().inbox, event);
    if (inbox !== get().inbox) set({ inbox });
  },
  dismissDecision: () => set({ decided: null }),
  clearInbox: () => set((s) => (s.inbox === emptyInbox ? s : { inbox: emptyInbox })),
}));
