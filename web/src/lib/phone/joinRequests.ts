/**
 * Asking to join a campaign (docs/architecture/CAMPAIGN-JOIN-REQUESTS.md): the pure rules behind the open-tables
 * list and the DM's request screen. No network or React in here, so each is a plain function a test can call.
 */

export const MAX_JOIN_MESSAGE = 280;

export interface MyRequest {
  id: string;
  status: 'pending' | 'declined';
  createdAt: number;
  /** Declined only: when they may ask again (epoch ms). */
  retryAfter?: number;
}

export interface OpenTable {
  id: string;
  name: string;
  dmName: string;
  playerCount: number;
  myRequest: MyRequest | null;
}

export type CardState =
  { kind: 'none' } | { kind: 'pending' } | { kind: 'declined'; retryAfter: number | undefined };

/** What a table's card offers: ask, withdraw, or (after a no) wait. A declined request whose wait is over is a fresh ask. */
export function cardState(request: MyRequest | null, now: number): CardState {
  if (!request) return { kind: 'none' };
  if (request.status === 'pending') return { kind: 'pending' };
  if (request.retryAfter !== undefined && request.retryAfter <= now) return { kind: 'none' };
  return { kind: 'declined', retryAfter: request.retryAfter };
}

/** "You can ask again Mon 16 Nov", or a plain fallback when the server gave no date. */
export function retryText(retryAfter: number | undefined, locale?: string): string {
  if (retryAfter === undefined) return 'You can ask again later';
  const day = new Date(retryAfter).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `You can ask again ${day}`;
}

/** Characters as a person counts them (an emoji is one), the way the server counts the limit. */
export const messageLength = (text: string): number => [...text].length;

/**
 * A sentence for a failed request. The server's 409 and 429 messages are written for people (it says which rule was hit),
 * so they pass through; a 404 means the table closed its doors since the list loaded.
 */
export function joinErrorMessage(status: number, serverMessage: string): string {
  switch (status) {
    case 404:
      return 'This table is no longer taking requests.';
    case 409:
    case 429:
      return serverMessage || 'That did not go through. Try again later.';
    case 400:
      return `Keep the message to ${MAX_JOIN_MESSAGE} characters.`;
    default:
      return 'Could not reach the server. Try again.';
  }
}

/** One request as the DM sees it. */
export interface DmRequest {
  id: string;
  campaignId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  message: string | null;
  status: 'pending' | 'approved' | 'declined';
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  /** Allow join was switched off after this was asked, so it cannot be approved. */
  closed: boolean;
}

/** Pending first, oldest first (first come, first answered); then decisions, newest first. */
export function sortRequests(list: readonly DmRequest[]): DmRequest[] {
  const pending = list
    .filter((r) => r.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);
  const decided = list
    .filter((r) => r.status !== 'pending')
    .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt));
  return [...pending, ...decided];
}

export const pendingIds = (list: readonly DmRequest[]): string[] =>
  list.filter((r) => r.status === 'pending').map((r) => r.id);

/**
 * The DM's pending request ids after a `join.request` frame: a new one adds its id, a withdrawn one removes it. Anything
 * for another campaign, or malformed, leaves the set as it was (the same array, so a store can skip the update).
 */
export function applyJoinRequestFrame(
  ids: readonly string[],
  campaignId: string,
  data: unknown,
): readonly string[] {
  if (typeof data !== 'object' || data === null) return ids;
  const d = data as { campaignId?: unknown; requestId?: unknown; status?: unknown };
  if (d.campaignId !== campaignId || typeof d.requestId !== 'string') return ids;
  if (d.status === 'pending') return ids.includes(d.requestId) ? ids : [...ids, d.requestId];
  if (d.status === 'withdrawn')
    return ids.includes(d.requestId) ? ids.filter((i) => i !== d.requestId) : ids;
  return ids;
}

export interface Decided {
  campaignId: string;
  approved: boolean;
}

/** A `join.decided` frame, or undefined when it is not one. */
export function parseDecided(data: unknown): Decided | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const d = data as { campaignId?: unknown; approved?: unknown };
  if (typeof d.campaignId !== 'string' || typeof d.approved !== 'boolean') return undefined;
  return { campaignId: d.campaignId, approved: d.approved };
}
