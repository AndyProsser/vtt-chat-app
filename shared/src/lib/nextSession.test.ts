import { describe, expect, it } from 'vitest';

import { nextSession, whenLabel, type SessionLike } from './nextSession.js';

const at = (iso: string) => new Date(iso).getTime();
const s = (id: string, startsAt: number, cancelledAt: number | null = null): SessionLike => ({
  session: { id, startsAt, title: id, cancelledAt },
  mine: null,
});
const now = at('2026-11-21T10:00:00');

describe('nextSession', () => {
  it('is the earliest upcoming session', () => {
    const list = [
      s('c', at('2026-11-30T19:00:00')),
      s('a', at('2026-11-22T19:00:00')),
      s('b', at('2026-11-25T19:00:00')),
    ];
    expect(nextSession(list, now)?.session.id).toBe('a');
  });
  it('skips cancelled sessions', () => {
    const list = [s('a', at('2026-11-22T19:00:00'), 1), s('b', at('2026-11-25T19:00:00'))];
    expect(nextSession(list, now)?.session.id).toBe('b');
  });
  it('keeps a session that started recently, and drops one that ended long ago', () => {
    expect(nextSession([s('now', now - 60 * 60_000)], now)?.session.id).toBe('now');
    expect(nextSession([s('old', now - 5 * 60 * 60_000)], now)).toBeUndefined();
  });
  it('is undefined with nothing scheduled', () => {
    expect(nextSession([], now)).toBeUndefined();
  });
});

describe('whenLabel', () => {
  const l = 'en-AU';
  it('says today and tomorrow', () => {
    expect(whenLabel(at('2026-11-21T19:30:00'), now, l)).toMatch(/^Today, 7:30\s?pm$/i);
    expect(whenLabel(at('2026-11-22T19:30:00'), now, l)).toMatch(/^Tomorrow, 7:30\s?pm$/i);
  });
  it('uses the weekday within a week, and the date beyond it', () => {
    expect(whenLabel(at('2026-11-25T19:30:00'), now, l)).toMatch(/^Wed 7:30\s?pm$/i);
    expect(whenLabel(at('2026-12-02T19:30:00'), now, l)).toMatch(/^Wed 2 Dec, 7:30\s?pm$/i);
  });
  it('says Now for a session in progress', () => {
    expect(whenLabel(now - 1000, now, l)).toBe('Now');
  });
});
