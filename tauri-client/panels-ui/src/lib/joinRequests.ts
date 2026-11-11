import type {
  JoinInbox,
  JoinRequestRow,
  MyJoinRequest,
  OpenCampaignCard,
  SyncEvent,
} from '../types/index.js';

/** The longest note a person may attach to a request (the server's own cap is the real gate). */
export const JOIN_MESSAGE_MAX = 280;

/** How an open table's card looks, from the person's own request on it. */
export type CardState =
  { kind: 'none' } | { kind: 'pending' } | { kind: 'declined'; retryAfter: number | undefined };

export function cardState(mine: MyJoinRequest | null | undefined): CardState {
  if (!mine) return { kind: 'none' };
  if (mine.status === 'pending') return { kind: 'pending' };
  return { kind: 'declined', retryAfter: mine.retryAfter };
}

/** "You can ask again 14 Nov" (no clock needed: the server already hid cards whose wait is over). */
export function retryLabel(retryAfter: number | undefined, locale?: string): string {
  if (retryAfter === undefined || !Number.isFinite(retryAfter)) return 'You can ask again later';
  const date = new Date(retryAfter).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return `You can ask again ${date}`;
}

/** The counter under the message box: characters left, never below zero. */
export const messageCharsLeft = (message: string): number =>
  Math.max(0, JOIN_MESSAGE_MAX - message.length);

/** The relay rejects with `{ code, message }`; says what a person should read for each case. */
export function joinErrorMessage(error: unknown): string {
  const e = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';
  switch (code) {
    case 'not_found':
      return 'That table is not taking requests any more.';
    case 'conflict':
      if (/already in/i.test(message)) return 'You are already in that campaign.';
      if (/again|few days/i.test(message))
        return 'You asked this table recently. Try again in a few days.';
      if (/dealt with/i.test(message)) return 'That request was already dealt with.';
      if (/allow join/i.test(message)) return 'Joining is closed. Turn Allow join on to approve.';
      return 'You have too many open requests. Withdraw one first.';
    case 'rate_limited':
      return 'Too many requests. Wait a little and try again.';
    case 'invalid_input':
      return 'That message could not be sent. Check it and try again.';
    case 'forbidden':
      return 'Only the DM can do that.';
    case 'unreachable':
      return message || 'Could not reach the server.';
    default:
      return message || 'Something went wrong.';
  }
}

export const emptyInbox: JoinInbox = { campaignId: null, allowJoin: true, requests: [] };

/** Requests waiting for an answer that the DM can act on now. */
export const pendingCount = (inbox: JoinInbox): number =>
  inbox.requests.filter((r) => r.status === 'pending' && !r.closed).length;

/** Waiting first (oldest first, so the longest wait is on top), then answered ones, newest first. */
export function sortRequests(requests: readonly JoinRequestRow[]): JoinRequestRow[] {
  return [...requests].sort((a, b) => {
    const aw = a.status === 'pending';
    const bw = b.status === 'pending';
    if (aw !== bw) return aw ? -1 : 1;
    if (aw) return a.createdAt - b.createdAt;
    return (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt);
  });
}

/** Replaces the inbox with what the server's list says (the truth; live frames only nudge it). */
export function loadInbox(
  campaignId: string,
  body: { allowJoin: boolean; requests: JoinRequestRow[] },
): JoinInbox {
  return { campaignId, allowJoin: body.allowJoin, requests: body.requests };
}

/** Marks one request answered (the DM just decided it), keeping it in the recent list. */
export function decideInbox(inbox: JoinInbox, requestId: string, approved: boolean): JoinInbox {
  return {
    ...inbox,
    requests: inbox.requests.map((r) =>
      r.id === requestId
        ? { ...r, status: approved ? 'approved' : 'declined', decidedAt: Date.now() }
        : r,
    ),
  };
}

/**
 * Follows a live `join.request` frame (DM only). Idempotent: the same frame twice changes nothing, and
 * a frame for another campaign is ignored. Returns the same object when nothing changed.
 */
export function applyJoinRequestEvent(inbox: JoinInbox, event: SyncEvent): JoinInbox {
  if (event.t !== 'join.request' || typeof event.d !== 'object' || event.d === null) return inbox;
  const d = event.d as Record<string, unknown>;
  if (d.campaignId !== inbox.campaignId || typeof d.requestId !== 'string') return inbox;
  const id = d.requestId;
  const known = inbox.requests.find((r) => r.id === id);
  if (d.status === 'withdrawn') {
    return known ? { ...inbox, requests: inbox.requests.filter((r) => r.id !== id) } : inbox;
  }
  if (d.status !== 'pending' || known) return inbox;
  const row: JoinRequestRow = {
    id,
    campaignId: String(d.campaignId),
    userId: typeof d.userId === 'string' ? d.userId : '',
    displayName: typeof d.displayName === 'string' ? d.displayName : 'Someone',
    avatarUrl: null,
    message: typeof d.message === 'string' ? d.message : '',
    status: 'pending',
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
    decidedAt: null,
    decidedBy: null,
    closed: !inbox.allowJoin,
  };
  return { ...inbox, requests: [...inbox.requests, row] };
}

/** A `join.decided` frame for this person, or `null` for any other event. */
export function joinDecision(
  event: SyncEvent,
): { campaignId: string; requestId: string; approved: boolean } | null {
  if (event.t !== 'join.decided' || typeof event.d !== 'object' || event.d === null) return null;
  const d = event.d as Record<string, unknown>;
  if (typeof d.campaignId !== 'string' || typeof d.requestId !== 'string') return null;
  return { campaignId: d.campaignId, requestId: d.requestId, approved: d.approved === true };
}

/** Open-table list after a decision: declined shows as "Not this time" until the wait is over. */
export function markDeclined(
  cards: readonly OpenCampaignCard[],
  campaignId: string,
  requestId: string,
  now: number,
  waitMs = 7 * 24 * 60 * 60 * 1000,
): OpenCampaignCard[] {
  return cards.map((c) =>
    c.id === campaignId
      ? {
          ...c,
          myRequest: {
            id: requestId,
            status: 'declined',
            createdAt: now,
            retryAfter: now + waitMs,
          },
        }
      : c,
  );
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago" (computed on render: no timer). */
export function relativeTime(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** True when a request that was waiting is no longer on the open list: the DM said yes and you are in. */
export function vanishedPending(
  before: readonly OpenCampaignCard[],
  after: readonly OpenCampaignCard[],
): boolean {
  return before.some((b) => b.myRequest?.status === 'pending' && !after.some((a) => a.id === b.id));
}
