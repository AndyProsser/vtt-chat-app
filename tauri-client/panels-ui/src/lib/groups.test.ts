import { describe, expect, it } from 'vitest';

import type { Member, PartyView } from '../types/index.js';
import { groupDrop, groupNameOf, lanes, moveCommand, moveTargets, railSections } from './groups.js';

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

describe('rail sections', () => {
  const mk = (userId: string, role: 'dm' | 'player', name: string, online = true) =>
    ({
      userId,
      role,
      displayName: name,
      online,
      inVoice: false,
      muted: false,
    }) as unknown as Member;
  const members = [
    mk('dm', 'dm', 'Test DM'),
    mk('b', 'player', 'Bram'),
    mk('a', 'player', 'Aria'),
    mk('c', 'player', 'Cass', false),
  ];
  const view: PartyView = {
    split: true,
    parties: [{ id: 'p1', name: 'Scouts' }],
    assignments: { a: 'p1' },
  } as unknown as PartyView;

  it('lists the main table first and then each group, people in rail order', () => {
    expect(railSections(members, view).map((s) => [s.id, s.members.map((x) => x.userId)])).toEqual([
      ['main', ['b', 'c']],
      ['p1', ['a']],
    ]);
  });

  it('names the group a person is in only while the table is split', () => {
    expect(groupNameOf(view, 'a')).toBe('Scouts');
    expect(groupNameOf(view, 'b')).toBe('Main Party');
    expect(groupNameOf({ ...view, split: false }, 'a')).toBeUndefined();
  });
});

describe('moveTargets (the keyboard way to move someone)', () => {
  it('offers every other group, then a new one, never the one they are in', () => {
    const sections = railSections(members, view({ b: 'p1' }));
    expect(moveTargets(sections, 'a').map((t) => t.id)).toEqual(['p1', 'p2', 'new']);
    expect(moveTargets(sections, 'b').map((t) => t.id)).toEqual(['main', 'p2', 'new']);
  });
  it('labels them with the group names', () => {
    const sections = railSections(members, view({}));
    expect(moveTargets(sections, 'a').map((t) => t.label)).toEqual([
      'Scouts',
      'Guards',
      'New group',
    ]);
  });
});
