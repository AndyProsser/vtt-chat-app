import { describe, expect, it } from 'vitest';

import {
  applyJoinRequestFrame,
  cardState,
  type DmRequest,
  joinErrorMessage,
  messageLength,
  parseDecided,
  pendingIds,
  retryText,
  sortRequests,
} from './joinRequests.js';

const NOW = new Date(2026, 10, 12).getTime();
const req = (o: Partial<DmRequest>): DmRequest => ({
  id: 'r',
  campaignId: 'c',
  userId: 'u',
  displayName: 'N',
  avatarUrl: null,
  message: null,
  status: 'pending',
  createdAt: 0,
  decidedAt: null,
  decidedBy: null,
  closed: false,
  ...o,
});

describe('card state', () => {
  it('offers a request when there is none', () => {
    expect(cardState(null, NOW)).toEqual({ kind: 'none' });
  });
  it('shows a pending request as sent', () => {
    expect(cardState({ id: 'a', status: 'pending', createdAt: 1 }, NOW)).toEqual({
      kind: 'pending',
    });
  });
  it('holds a declined request until its date, then offers a fresh ask', () => {
    const declined = { id: 'a', status: 'declined' as const, createdAt: 1, retryAfter: NOW + 1000 };
    expect(cardState(declined, NOW)).toEqual({ kind: 'declined', retryAfter: NOW + 1000 });
    expect(cardState(declined, NOW + 1000)).toEqual({ kind: 'none' });
  });
});

describe('retry text', () => {
  it('names the day', () => {
    expect(retryText(new Date(2026, 10, 19).getTime(), 'en-AU')).toMatch(
      /^You can ask again .*19 Nov/,
    );
  });
  it('falls back without a date', () => {
    expect(retryText(undefined)).toBe('You can ask again later');
  });
});

describe('error messages', () => {
  it('passes the server wording for a conflict or a rate limit', () => {
    expect(joinErrorMessage(409, 'you already have 5 open requests')).toBe(
      'you already have 5 open requests',
    );
    expect(joinErrorMessage(429, 'too many requests; try again later')).toBe(
      'too many requests; try again later',
    );
  });
  it('explains the rest in its own words', () => {
    expect(joinErrorMessage(404, 'not found')).toMatch(/no longer taking/);
    expect(joinErrorMessage(400, 'x')).toMatch(/280/);
    expect(joinErrorMessage(500, 'x')).toMatch(/Could not reach/);
  });
  it('counts an emoji as one character', () => {
    expect(messageLength('a😀')).toBe(2);
  });
});

describe('request list', () => {
  it('puts pending first (oldest first) then decisions newest first', () => {
    const out = sortRequests([
      req({ id: 'd1', status: 'declined', createdAt: 1, decidedAt: 50 }),
      req({ id: 'p2', createdAt: 20 }),
      req({ id: 'd2', status: 'approved', createdAt: 2, decidedAt: 60 }),
      req({ id: 'p1', createdAt: 10 }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['p1', 'p2', 'd2', 'd1']);
    expect(pendingIds(out)).toEqual(['p1', 'p2']);
  });
});

describe('join.request frames', () => {
  const frame = (o: object) => ({ campaignId: 'c', requestId: 'r1', status: 'pending', ...o });
  it('adds a new pending request once', () => {
    const one = applyJoinRequestFrame([], 'c', frame({}));
    expect(one).toEqual(['r1']);
    expect(applyJoinRequestFrame(one, 'c', frame({}))).toBe(one);
  });
  it('removes a withdrawn one', () => {
    expect(applyJoinRequestFrame(['r1', 'r2'], 'c', frame({ status: 'withdrawn' }))).toEqual([
      'r2',
    ]);
  });
  it('ignores another campaign, unknown status and junk', () => {
    const ids = ['r1'];
    expect(applyJoinRequestFrame(ids, 'c', frame({ campaignId: 'x' }))).toBe(ids);
    expect(applyJoinRequestFrame(ids, 'c', frame({ status: 'weird' }))).toBe(ids);
    expect(applyJoinRequestFrame(ids, 'c', null)).toBe(ids);
    expect(applyJoinRequestFrame(ids, 'c', { campaignId: 'c' })).toBe(ids);
  });
});

describe('join.decided frames', () => {
  it('reads a well-formed frame', () => {
    expect(parseDecided({ campaignId: 'c', requestId: 'r', approved: true })).toEqual({
      campaignId: 'c',
      approved: true,
    });
  });
  it('rejects junk', () => {
    expect(parseDecided({ campaignId: 'c' })).toBeUndefined();
    expect(parseDecided(undefined)).toBeUndefined();
  });
});
