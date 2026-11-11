import { describe, expect, it } from 'vitest';

import type { JoinInbox, JoinRequestRow } from '../types/index.js';
import {
  applyJoinRequestEvent,
  cardState,
  decideInbox,
  joinDecision,
  joinErrorMessage,
  markDeclined,
  messageCharsLeft,
  pendingCount,
  relativeTime,
  retryLabel,
  vanishedPending,
  sortRequests,
} from './joinRequests.js';

const row = (over: Partial<JoinRequestRow>): JoinRequestRow => ({
  id: 'r1',
  campaignId: 'c1',
  userId: 'u1',
  displayName: 'Pip',
  avatarUrl: null,
  message: '',
  status: 'pending',
  createdAt: 100,
  decidedAt: null,
  decidedBy: null,
  closed: false,
  ...over,
});
const inbox = (requests: JoinRequestRow[], allowJoin = true): JoinInbox => ({
  campaignId: 'c1',
  allowJoin,
  requests,
});
const frame = (d: Record<string, unknown>) => ({ t: 'join.request', d });

describe('open table cards', () => {
  it('maps myRequest to a card state', () => {
    expect(cardState(null)).toEqual({ kind: 'none' });
    expect(cardState({ id: 'a', status: 'pending', createdAt: 1 })).toEqual({ kind: 'pending' });
    expect(cardState({ id: 'a', status: 'declined', createdAt: 1, retryAfter: 9 })).toEqual({
      kind: 'declined',
      retryAfter: 9,
    });
  });
  it('words the retry date, with a fallback when the server gave none', () => {
    expect(retryLabel(Date.UTC(2026, 10, 14, 12), 'en-AU')).toMatch(/^You can ask again 14 Nov/);
    expect(retryLabel(undefined)).toBe('You can ask again later');
  });
  it('counts the message characters left, never below zero', () => {
    expect(messageCharsLeft('')).toBe(280);
    expect(messageCharsLeft('x'.repeat(300))).toBe(0);
  });
  it('marks a table declined after a no', () => {
    const cards = [
      { id: 'c1', name: 'A', dmName: 'D', playerCount: 2, myRequest: null },
      { id: 'c2', name: 'B', dmName: 'D', playerCount: 2, myRequest: null },
    ];
    const next = markDeclined(cards, 'c1', 'r9', 1000, 50);
    expect(next[0]?.myRequest).toEqual({
      id: 'r9',
      status: 'declined',
      createdAt: 1000,
      retryAfter: 1050,
    });
    expect(next[1]).toBe(cards[1]);
  });
});

describe('error wording', () => {
  it('maps each server answer to a friendly line', () => {
    expect(joinErrorMessage({ code: 'not_found', message: 'x' })).toMatch(/not taking requests/);
    expect(
      joinErrorMessage({ code: 'conflict', message: 'you are already in this campaign' }),
    ).toMatch(/already in/);
    expect(
      joinErrorMessage({ code: 'conflict', message: 'you can ask this table again in a few days' }),
    ).toMatch(/recently/);
    expect(joinErrorMessage({ code: 'conflict', message: 'too many open requests' })).toMatch(
      /too many open/i,
    );
    expect(joinErrorMessage({ code: 'rate_limited', message: '' })).toMatch(/Too many requests/);
    expect(joinErrorMessage({ code: 'invalid_input', message: '' })).toMatch(/could not be sent/);
    expect(joinErrorMessage({ code: 'weird', message: 'boom' })).toBe('boom');
    expect(joinErrorMessage('nope')).toBe('Something went wrong.');
  });
});

describe('the DM inbox', () => {
  it('counts only waiting requests that can be approved', () => {
    expect(
      pendingCount(
        inbox([
          row({ id: 'a' }),
          row({ id: 'b', closed: true }),
          row({ id: 'c', status: 'approved' }),
        ]),
      ),
    ).toBe(1);
  });
  it('adds a live request once and removes a withdrawn one', () => {
    const live = frame({
      campaignId: 'c1',
      requestId: 'n',
      status: 'pending',
      displayName: 'Ana',
      message: 'hi',
      createdAt: 5,
    });
    const added = applyJoinRequestEvent(inbox([]), live);
    expect(added.requests).toHaveLength(1);
    expect(added.requests[0]).toMatchObject({
      id: 'n',
      displayName: 'Ana',
      message: 'hi',
      createdAt: 5,
    });
    expect(applyJoinRequestEvent(added, live)).toBe(added);
    const gone = applyJoinRequestEvent(
      added,
      frame({ campaignId: 'c1', requestId: 'n', status: 'withdrawn' }),
    );
    expect(gone.requests).toEqual([]);
  });
  it('ignores other campaigns, other frames and unknown withdrawals', () => {
    const base = inbox([row({})]);
    expect(
      applyJoinRequestEvent(base, frame({ campaignId: 'zz', requestId: 'n', status: 'pending' })),
    ).toBe(base);
    expect(applyJoinRequestEvent(base, { t: 'chat.whisper', d: {} })).toBe(base);
    expect(
      applyJoinRequestEvent(base, frame({ campaignId: 'c1', requestId: 'q', status: 'withdrawn' })),
    ).toBe(base);
  });
  it('shows a live request as closed when Allow join is off', () => {
    const next = applyJoinRequestEvent(
      inbox([], false),
      frame({ campaignId: 'c1', requestId: 'n', status: 'pending' }),
    );
    expect(next.requests[0]?.closed).toBe(true);
  });
  it('keeps a decided request in the list', () => {
    const next = decideInbox(inbox([row({})]), 'r1', true);
    expect(next.requests[0]).toMatchObject({ status: 'approved' });
    expect(pendingCount(next)).toBe(0);
  });
  it('sorts waiting requests oldest first, then answered ones newest first', () => {
    const sorted = sortRequests([
      row({ id: 'old-no', status: 'declined', createdAt: 1, decidedAt: 10 }),
      row({ id: 'new-wait', createdAt: 50 }),
      row({ id: 'new-yes', status: 'approved', createdAt: 2, decidedAt: 20 }),
      row({ id: 'old-wait', createdAt: 5 }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['old-wait', 'new-wait', 'new-yes', 'old-no']);
  });
});

describe('decisions and time', () => {
  it('reads a join.decided frame', () => {
    expect(
      joinDecision({ t: 'join.decided', d: { campaignId: 'c', requestId: 'r', approved: true } }),
    ).toEqual({
      campaignId: 'c',
      requestId: 'r',
      approved: true,
    });
    expect(joinDecision({ t: 'join.decided', d: { campaignId: 'c' } })).toBeNull();
    expect(joinDecision({ t: 'x', d: {} })).toBeNull();
  });
  it('words how long ago', () => {
    expect(relativeTime(0, 30_000)).toBe('just now');
    expect(relativeTime(0, 60_000)).toBe('1 minute ago');
    expect(relativeTime(0, 3 * 3600_000)).toBe('3 hours ago');
    expect(relativeTime(0, 2 * 86400_000)).toBe('2 days ago');
  });
});

describe('noticing an approval from the list alone', () => {
  const card = (id: string, pending: boolean) => ({
    id,
    name: id,
    dmName: 'D',
    playerCount: 1,
    myRequest: pending ? { id: 'r', status: 'pending' as const, createdAt: 1 } : null,
  });
  it('is true only when a waiting request left the list', () => {
    expect(vanishedPending([card('a', true)], [])).toBe(true);
    expect(vanishedPending([card('a', true)], [card('a', true)])).toBe(false);
    expect(vanishedPending([card('a', false)], [])).toBe(false);
  });
});
