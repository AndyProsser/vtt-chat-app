import { describe, expect, it } from 'vitest';

import type { Member, PartyView } from '../types/index.js';
import { asideInfo, asideText, asideToggle } from './aside.js';

const members = [
  { userId: 'dm', displayName: 'Dee', role: 'dm' },
  { userId: 'p1', displayName: 'Pat', role: 'player', character: { name: 'Aria' } },
  { userId: 'p2', displayName: 'Sam', role: 'player' },
] as unknown as Member[];
const none: PartyView = { parties: [], assignments: {}, split: false, aside: null };
const talk: PartyView = { ...none, aside: { dmId: 'dm', playerId: 'p1' } };

describe('aside', () => {
  it('has no info when nobody is aside', () => {
    expect(asideInfo(none, members, 'dm')).toBeUndefined();
  });
  it('tells each person their own side, using the name the table knows', () => {
    expect(asideInfo(talk, members, 'dm')).toMatchObject({ role: 'dm', name: 'Aria' });
    expect(asideInfo(talk, members, 'p1')?.role).toBe('player');
    const other = asideInfo(talk, members, 'p2');
    expect(other?.role).toBe('table');
    expect(asideText(other!).title).toBe('The DM is speaking privately with Aria');
    expect(asideText(asideInfo(talk, members, 'dm')!).detail).toContain('cannot hear the table');
  });
  it('a double-click starts the talk with that player, ends it on the same player, and switches to another', () => {
    expect(asideToggle(none, 'p1')).toBe('p1');
    expect(asideToggle(talk, 'p1')).toBeNull();
    expect(asideToggle(talk, 'p2')).toBe('p2');
  });
});
