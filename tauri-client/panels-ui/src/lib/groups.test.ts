import { describe, expect, it } from 'vitest';

import type { Member, PartyView } from '../types/index.js';
import { groupDrop, lanes, moveCommand } from './groups.js';

const m = (userId: string, name: string, role: Member['role'] = 'player'): Member => ({
  userId,
  displayName: name,
  role,
  character: null,
  online: true,
  inVoice: true,
  muted: false,
});
const members = [m('dm', 'Dee', 'dm'), m('a', 'Amy'), m('b', 'Bob'), m('c', 'Cat')];
const view = (assignments: Record<string, string>): PartyView => ({
  parties: [
    { id: 'p1', name: 'Scouts' },
    { id: 'p2', name: 'Guards' },
  ],
  assignments,
  split: Object.keys(assignments).length > 0,
});

describe('lanes', () => {
  it('puts players at the main table unless assigned, leaves the DM out, and keeps party order', () => {
    const l = lanes(members, view({ b: 'p1' }));
    expect(l.map((x) => [x.id, x.name, x.members.map((p) => p.userId)])).toEqual([
      [null, 'Main Party', ['a', 'c']],
      ['p1', 'Scouts', ['b']],
      ['p2', 'Guards', []],
    ]);
  });
  it('sends someone assigned to a group that no longer exists back to the main table', () => {
    const l = lanes(members, view({ a: 'gone' }));
    expect(l[0]!.members.map((p) => p.userId)).toEqual(['a', 'b', 'c']);
  });
});

describe('moveCommand', () => {
  it('asks to move a player into a group, or back to the main table with null', () => {
    expect(moveCommand(view({}), 'a', 'p1')).toEqual({ userId: 'a', partyId: 'p1' });
    expect(moveCommand(view({ a: 'p1' }), 'a', null)).toEqual({ userId: 'a', partyId: null });
  });
  it('does nothing when dropped where they already are', () => {
    expect(moveCommand(view({ a: 'p1' }), 'a', 'p1')).toBeUndefined();
    expect(moveCommand(view({}), 'a', null)).toBeUndefined();
  });
});

describe('groupDrop', () => {
  const name = () => 'Plan B';
  it('starts a new group, named for them, when dropped on the new-group zone', () => {
    expect(groupDrop(view({}), 'a', 'new', name)).toEqual({
      kind: 'create',
      userId: 'a',
      name: 'Plan B',
    });
  });
  it('moves between lanes, with the main party as null', () => {
    expect(groupDrop(view({}), 'a', 'p1', name)).toEqual({
      kind: 'move',
      move: { userId: 'a', partyId: 'p1' },
    });
    expect(groupDrop(view({ a: 'p1' }), 'a', 'main', name)).toEqual({
      kind: 'move',
      move: { userId: 'a', partyId: null },
    });
  });
  it('does nothing when dropped where they are, or on nothing', () => {
    expect(groupDrop(view({ a: 'p1' }), 'a', 'p1', name)).toBeUndefined();
    expect(groupDrop(view({}), 'a', 'main', name)).toBeUndefined();
    expect(groupDrop(view({}), 'a', undefined, name)).toBeUndefined();
  });
});
