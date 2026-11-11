import { parseComposerInput } from '@vtt-chat-app/shared';
import { describe, expect, it } from 'vitest';

import { chatContext, nextUpcomingSession, planSend, visibleSuggestions } from './compose.js';
import type { Member, SessionItem } from '../../types/phone.js';

const members: Member[] = [
  { userId: 'me', displayName: 'Sam', role: 'player', character: null, online: true },
  { userId: 'dm', displayName: 'Dee', role: 'dm', character: { name: 'Narrator' }, online: true },
];
const ctx = chatContext('me', members);

describe('chatContext', () => {
  it('maps members, character names included', () => {
    expect(ctx.members[1]).toEqual({
      id: 'dm',
      name: 'Dee',
      characterName: 'Narrator',
      role: 'dm',
    });
  });
});

describe('planSend', () => {
  it('sends a say line with its language', () => {
    expect(planSend(parseComposerInput('/say-elvish Hail', ctx))).toEqual({
      text: 'Hail',
      say: { kind: 'say', lang: 'elvish' },
    });
  });
  it('sends a plain line as chat', () => {
    expect(planSend(parseComposerInput('hello', ctx))).toEqual({
      text: 'hello',
      say: { kind: 'chat' },
    });
  });
  it('turns /dm into a whisper', () => {
    expect(planSend(parseComposerInput('/dm psst', ctx))).toEqual({
      text: 'psst',
      say: { to: 'dm' },
    });
  });
  it('turns /late into an OOC line plus an RSVP', () => {
    expect(planSend(parseComposerInput('/late 20 min', ctx))).toEqual({
      text: 'Sam is running late: 20 min',
      say: { kind: 'ooc' },
      rsvp: 'late',
    });
  });
  it('has no RSVP for /brb and no plan for an error', () => {
    expect(planSend(parseComposerInput('/brb', ctx))?.rsvp).toBeUndefined();
    expect(planSend(parseComposerInput('/say', ctx))).toBeUndefined();
  });
});

const item = (
  id: string,
  startsAt: number,
  over: Partial<SessionItem['session']> = {},
): SessionItem => ({
  session: { id, startsAt, durationMinutes: 60, title: id, notes: '', cancelledAt: null, ...over },
  counts: { yes: 0, late: 0, no: 0 },
  mine: null,
});

describe('nextUpcomingSession', () => {
  const now = 1_000_000_000;
  it('picks the earliest session that has not ended, skipping cancelled ones', () => {
    const list = [
      item('later', now + 9_000_000),
      item('cancelled', now + 1_000_000, { cancelledAt: 5 }),
      item('past', now - 10_000_000),
      item('soon', now + 2_000_000),
    ];
    expect(nextUpcomingSession(list, now)?.session.id).toBe('soon');
  });
  it('counts a session in progress, and returns nothing when there is none', () => {
    expect(nextUpcomingSession([item('now', now - 60_000)], now)?.session.id).toBe('now');
    expect(nextUpcomingSession([item('past', now - 10_000_000)], now)).toBeUndefined();
    expect(nextUpcomingSession([], now)).toBeUndefined();
  });
});

describe('visibleSuggestions', () => {
  it('hides a command that is already typed in full', () => {
    const one = {
      kind: 'commands' as const,
      items: [{ label: '/late', insert: '/late ', description: '' }],
    };
    expect(visibleSuggestions(one, '/late')).toEqual([]);
    expect(visibleSuggestions(one, '/la')).toHaveLength(1);
  });
});
