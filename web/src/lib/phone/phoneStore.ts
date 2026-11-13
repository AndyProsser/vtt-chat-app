import { create } from 'zustand';

import type { CampaignItem, ChatLine, LiveState, Member } from '../../types/phone.js';
import { lineFromFrame, mergeLines } from './chat.js';
import { ERROR_FRAME_MESSAGES } from './compose.js';
import { applyJoinRequestFrame, type Decided, parseDecided } from './joinRequests.js';
import { applyPresenceFrame } from './presence.js';

export type Tab = 'chat' | 'sessions' | 'handouts' | 'history';

interface PhoneState {
  /** The server accepted this browser's session cookie (the cookie itself is never visible to script). */
  authed: boolean;
  userId: string | undefined;
  campaigns: CampaignItem[];
  campaignId: string | undefined;
  tab: Tab;
  members: Member[];
  lines: ChatLine[];
  live: LiveState;
  /** Chat lines that arrived while the Chat tab was not showing. */
  unread: number;
  /** The server refused the last line's kind or language; the composer shows it under the box. */
  chatError: string | undefined;
  /** The DM's open join-request ids for the current campaign (empty for a player). */
  joinPending: readonly string[];
  /** The latest answer to a request this person made, until they dismiss the banner. */
  decision: Decided | undefined;
  /** Bumped when a live frame says the handouts / sessions changed; the tabs read their list again. */
  handoutsRev: number;
  sessionsRev: number;

  signedIn(userId: string | undefined): void;
  signedOut(): void;
  setCampaigns(campaigns: CampaignItem[]): void;
  pickCampaign(id: string | undefined): void;
  setTab(tab: Tab): void;
  setLive(live: LiveState): void;
  setJoinPending(ids: readonly string[]): void;
  dismissDecision(): void;
  clearChatError(): void;
  addLines(lines: ChatLine[]): void;
  /** One frame from the live stream. */
  onFrame(type: string, data: unknown): void;
}

const FRESH = {
  members: [],
  lines: [],
  unread: 0,
  chatError: undefined,
  joinPending: [] as readonly string[],
  live: 'offline' as LiveState,
};

export const usePhoneStore = create<PhoneState>((set, get) => ({
  authed: false,
  userId: undefined,
  campaigns: [],
  campaignId: undefined,
  tab: 'chat',
  decision: undefined,
  handoutsRev: 0,
  sessionsRev: 0,
  ...FRESH,

  signedIn: (userId) => set({ authed: true, userId }),
  signedOut: () =>
    set({
      authed: false,
      decision: undefined,
      userId: undefined,
      campaigns: [],
      campaignId: undefined,
      ...FRESH,
    }),
  setCampaigns: (campaigns) => set({ campaigns }),
  pickCampaign: (campaignId) => set({ campaignId, tab: 'chat', ...FRESH }),
  setTab: (tab) => set({ tab, ...(tab === 'chat' ? { unread: 0 } : {}) }),
  setLive: (live) => set({ live }),
  setJoinPending: (joinPending) => set({ joinPending }),
  dismissDecision: () => set({ decision: undefined }),
  clearChatError: () => set({ chatError: undefined }),
  addLines: (lines) => set((s) => ({ lines: mergeLines(s.lines, lines) })),

  onFrame(type, data) {
    const s = get();
    switch (type) {
      case 'snapshot': {
        const d = data as {
          members?: Member[];
          recentChat?: unknown[];
          recentWhispers?: unknown[];
        };
        const incoming = [...(d.recentChat ?? []), ...(d.recentWhispers ?? [])]
          .map(lineFromFrame)
          .filter((l): l is ChatLine => l !== undefined);
        // A (re)connect: whatever changed while the socket was down is only in the lists.
        set({
          members: d.members ?? s.members,
          lines: mergeLines(s.lines, incoming),
          handoutsRev: s.handoutsRev + 1,
          sessionsRev: s.sessionsRev + 1,
        });
        return;
      }
      case 'roster.update': {
        const d = data as { members?: Member[] };
        if (d.members) set({ members: d.members });
        return;
      }
      case 'presence.update':
      case 'audio.update': {
        const members = applyPresenceFrame(s.members, type, data);
        if (members !== s.members) set({ members });
        return;
      }
      case 'chat.message':
      case 'chat.whisper': {
        const line = lineFromFrame(data);
        if (!line) return;
        const mine = line.fromId === s.userId;
        set({
          lines: mergeLines(s.lines, [line]),
          unread: s.tab === 'chat' || mine ? s.unread : s.unread + 1,
        });
        return;
      }
      case 'handout.shown':
      case 'handout.removed':
      case 'handout.changed':
        set({ handoutsRev: s.handoutsRev + 1 });
        return;
      case 'notification': {
        // The server tells members about a scheduled, moved or cancelled session (and the DM about answers).
        const kind = (data as { kind?: unknown } | null)?.kind;
        if (typeof kind === 'string' && (kind.startsWith('session.') || kind.startsWith('rsvp.')))
          set({ sessionsRev: s.sessionsRev + 1 });
        return;
      }
      case 'join.request': {
        const next = s.campaignId
          ? applyJoinRequestFrame(s.joinPending, s.campaignId, data)
          : s.joinPending;
        if (next !== s.joinPending) set({ joinPending: next });
        return;
      }
      case 'join.decided': {
        const decision = parseDecided(data);
        if (decision) set({ decision });
        return;
      }
      case 'error': {
        const code = (data as { code?: unknown } | null)?.code;
        const message = typeof code === 'string' ? ERROR_FRAME_MESSAGES[code] : undefined;
        if (message) set({ chatError: message });
        return;
      }
      default:
        return;
    }
  },
}));
