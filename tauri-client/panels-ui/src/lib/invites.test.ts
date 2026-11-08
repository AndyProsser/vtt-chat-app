import { describe, expect, it } from 'vitest';

import { inviteLink, otherPlayers } from './invites.js';
import type { Member } from '../types/index.js';

describe('inviteLink', () => {
  it('is the join page on the server, with the code', () => {
    expect(inviteLink('https://play.example.com', 'ABCD-1234')).toBe(
      'https://play.example.com/join/ABCD-1234',
    );
    expect(inviteLink('http://192.168.1.5:3000/', 'X')).toBe('http://192.168.1.5:3000/join/X');
  });
  it('keeps a code that needs escaping safe', () => {
    expect(inviteLink('https://h', 'a b/c')).toBe('https://h/join/a%20b%2Fc');
  });
});

describe('otherPlayers', () => {
  const m = (userId: string, role: Member['role']): Member => ({
    userId,
    displayName: userId,
    role,
    character: null,
    online: true,
    inVoice: false,
    muted: true,
  });
  it('lists the people the DM role can be handed to: players other than me', () => {
    expect(
      otherPlayers([m('dm', 'dm'), m('a', 'player'), m('b', 'player')], 'dm').map((x) => x.userId),
    ).toEqual(['a', 'b']);
  });
});
