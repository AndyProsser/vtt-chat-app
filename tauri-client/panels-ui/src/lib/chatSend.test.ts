import { parseComposerInput, type ChatContext } from '@vtt-chat-app/shared';
import { describe, expect, it } from 'vitest';

import type { SessionView } from '../types/index.js';
import { nextUpcoming, planSend } from './chatSend.js';

const ctx: ChatContext = {
  selfId: 'me',
  members: [
    { id: 'me', name: 'Sam', role: 'player' },
    { id: 'dm', name: 'Dee', role: 'dm' },
    { id: 'p2', name: 'Pat', characterName: 'Thorin', role: 'player' },
  ],
};
const plan = (t: string) => planSend(parseComposerInput(t, ctx));

describe('planSend', () => {
  it('sends a plain line without kind or lang', () => {
    expect(plan('hello')).toEqual({ chat: { text: 'hello' } });
  });
  it('carries kind and lang', () => {
    expect(plan('/say-elvish Hail')).toEqual({
      chat: { text: 'Hail', kind: 'say', lang: 'elvish' },
    });
    expect(plan('/do waves')?.chat).toEqual({ text: 'waves', kind: 'do' });
  });
  it('maps whispers to the whisper path', () => {
    expect(plan('/tell Thorin psst')).toEqual({ whisper: { to: 'p2', text: 'psst' } });
    expect(plan('/dm hi')).toEqual({ whisper: { to: 'dm', text: 'hi' } });
  });
  it('posts quick commands as ooc, with the RSVP when there is one', () => {
    expect(plan('/late 20 min')).toEqual({
      chat: { text: 'Sam is running late: 20 min', kind: 'ooc' },
      rsvp: 'late',
    });
    expect(plan('/cant')?.rsvp).toBe('no');
    expect(plan('/work')?.rsvp).toBe('late');
    expect(plan('/brb')).toEqual({ chat: { text: 'Sam will be right back', kind: 'ooc' } });
  });
  it('plans nothing for an error', () => {
    expect(plan('/tell Nobody hi')).toBeUndefined();
  });
});

const view = (id: string, startsAt: number, cancelledAt: number | null = null): SessionView => ({
  session: { id, startsAt, durationMinutes: 180, title: id, notes: '', cancelledAt },
  rsvps: [],
  counts: { yes: 0, late: 0, no: 0 },
  mine: null,
});

describe('nextUpcoming', () => {
  it('picks the soonest future session that is not cancelled', () => {
    const list = [view('c', 300), view('past', 50), view('x', 150, 1), view('b', 200)];
    expect(nextUpcoming(list, 100)?.session.id).toBe('b');
  });
  it('is undefined when nothing is upcoming', () => {
    expect(nextUpcoming([view('past', 50)], 100)).toBeUndefined();
    expect(nextUpcoming([], 100)).toBeUndefined();
  });
});
