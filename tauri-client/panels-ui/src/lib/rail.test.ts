import { describe, expect, it } from 'vitest';

import type { Member } from '../types/index.js';
import {
  initials,
  memberAvatar,
  memberCard,
  railOrder,
  railState,
  speakingMembers,
} from './rail.js';

const m = (userId: string, over: Partial<Member> = {}): Member => ({
  userId,
  displayName: userId,
  role: 'player',
  character: null,
  online: true,
  inVoice: true,
  muted: false,
  status: 'online',
  ...over,
});

describe('railOrder', () => {
  it('puts the DM first, then players alphabetically by character or name, offline last', () => {
    const members = [
      m('zed'),
      m('amy', { character: { name: 'Zara' } }),
      m('bob', { online: false }),
      m('dm', { role: 'dm' }),
      m('cat', { character: { name: 'aria' } }),
    ];
    expect(railOrder(members).map((x) => x.userId)).toEqual(['dm', 'cat', 'amy', 'zed', 'bob']);
  });
});

describe('memberCard', () => {
  it('shows only the account name for a member with no character', () => {
    expect(memberCard(m('amy', { displayName: 'Amy' }))).toEqual({ title: 'Amy', lines: [] });
  });

  it('marks the DM', () => {
    expect(memberCard(m('d', { role: 'dm', displayName: 'Dee' })).lines).toEqual(['DM']);
  });

  it('joins only the character fields that exist and never prints undefined', () => {
    const card = memberCard(
      m('amy', {
        displayName: 'Amy',
        character: { name: 'Kaelen', className: 'Ranger' },
      }),
    );
    expect(card.title).toBe('Kaelen');
    expect(card.lines).toEqual(['Ranger', 'Amy']);
    const full = memberCard(
      m('amy', {
        displayName: 'Amy',
        character: { name: 'Kaelen', race: 'Wood elf', className: 'Ranger', level: 5 },
      }),
    );
    expect(full.lines[0]).toBe('Wood elf · Ranger 5');
    for (const line of [...card.lines, ...full.lines]) expect(line).not.toMatch(/undefined|null/);
  });
});

describe('speakingMembers', () => {
  it('ignores a speaking identity that is not on the roster', () => {
    const members = [m('amy'), m('bob')];
    expect(speakingMembers(members, new Set(['amy', 'egress-bot']))).toEqual(['amy']);
  });
});

describe('initials', () => {
  it('uses up to two letters from the name and survives odd input', () => {
    expect(initials('Kaelen Ashdown')).toBe('KA');
    expect(initials('mira')).toBe('M');
    expect(initials('  ')).toBe('?');
    expect(initials('')).toBe('?');
  });
});

describe('memberAvatar', () => {
  const base = {
    userId: 'u',
    displayName: 'U',
    role: 'player',
    online: true,
    inVoice: false,
    muted: false,
  };
  it('prefers the character portrait, then the person own, else nothing', () => {
    expect(
      memberAvatar({
        ...base,
        avatarUrl: 'emblem:crown',
        character: { name: 'C', avatarUrl: 'emblem:bow' },
      } as never),
    ).toBe('emblem:bow');
    expect(
      memberAvatar({
        ...base,
        avatarUrl: 'emblem:crown',
        character: { name: 'C', avatarUrl: null },
      } as never),
    ).toBe('emblem:crown');
    expect(memberAvatar({ ...base, avatarUrl: 'emblem:crown', character: null } as never)).toBe(
      'emblem:crown',
    );
    expect(memberAvatar({ ...base, character: null } as never)).toBeUndefined();
  });
});

describe('railState', () => {
  it('shows someone whose app is closed or signed out as disconnected, whatever they last chose', () => {
    expect(railState({ online: false, inVoice: true, status: 'online' })).toBe('disconnected');
    expect(railState({ online: false, inVoice: false, status: 'offline' })).toBe('disconnected');
  });
  it('shows a connected person who chose Offline as offline, not disconnected', () => {
    expect(railState({ online: true, inVoice: false, status: 'offline' })).toBe('offline');
  });
  it('shows Away, chat-only Online, and in-voice Online', () => {
    expect(railState({ online: true, inVoice: true, status: 'away' })).toBe('away');
    expect(railState({ online: true, inVoice: false, status: 'online' })).toBe('online');
    expect(railState({ online: true, inVoice: true, status: 'online' })).toBe('voice');
  });
});
