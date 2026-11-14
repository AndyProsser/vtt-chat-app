import { describe, expect, it } from 'vitest';

import { MAX_PARTIES, PartyState } from './partyState.js';

const DM = new Set(['dm']);
let n = 0;
const fresh = () => new PartyState(() => `p${++n}`);

describe('PartyState', () => {
  it('starts unsplit, with everyone at the main table hearing each other', () => {
    const s = fresh();
    expect(s.split).toBe(false);
    expect(s.hears('alice', 'bob', DM)).toBe(true);
    expect(s.snapshot()).toEqual({ parties: [], assignments: {}, split: false, aside: null });
  });

  it('players hear only their own group; the DM hears and is heard by every group', () => {
    const s = fresh();
    const a = s.create('Cellar');
    const b = s.create('Roof');
    s.move('alice', a.id);
    s.move('bob', a.id);
    s.move('carol', b.id);
    expect(s.hears('alice', 'bob', DM)).toBe(true); // same party
    expect(s.hears('alice', 'carol', DM)).toBe(false); // different parties
    expect(s.hears('carol', 'alice', DM)).toBe(false);
    expect(s.hears('dm', 'alice', DM)).toBe(true);
    expect(s.hears('carol', 'dm', DM)).toBe(true);
    expect(s.hears('alice', 'alice', DM)).toBe(false); // never hear yourself
  });

  it('players left at the main table still hear each other, but not those in a party', () => {
    const s = fresh();
    const a = s.create('Cellar');
    s.move('alice', a.id);
    expect(s.hears('bob', 'carol', DM)).toBe(true); // both at the main table
    expect(s.hears('bob', 'alice', DM)).toBe(false);
  });

  it('moves a player between parties and back to the main table', () => {
    const s = fresh();
    const a = s.create('A');
    const b = s.create('B');
    s.move('alice', a.id);
    s.move('alice', b.id);
    expect(s.groupOf('alice')).toBe(b.id);
    s.move('alice', null);
    expect(s.groupOf('alice')).toBeNull();
  });

  it('deleting a party sends its players back to the main table; reset ends the split', () => {
    const s = fresh();
    const a = s.create('A');
    s.move('alice', a.id);
    s.delete(a.id);
    expect(s.groupOf('alice')).toBeNull();
    expect(s.split).toBe(false);
    s.create('B');
    s.reset();
    expect(s.snapshot().parties).toEqual([]);
  });

  it('validates names, the party limit and unknown parties', () => {
    const s = fresh();
    expect(() => s.create('   ')).toThrow(/1–60/);
    expect(() => s.create('x'.repeat(61))).toThrow(/1–60/);
    for (let i = 0; i < MAX_PARTIES; i += 1) s.create(`p${i}`);
    expect(() => s.create('one too many')).toThrow(/at most/);
    expect(() => s.move('alice', 'nope')).toThrow(/no such party/);
    expect(() => s.rename('nope', 'x')).toThrow(/no such party/);
    expect(() => s.delete('nope')).toThrow(/no such party/);
  });

  it('forgets a player who left', () => {
    const s = fresh();
    const a = s.create('A');
    s.move('alice', a.id);
    s.forget('alice');
    expect(s.snapshot().assignments).toEqual({});
  });
});

describe('a private aside', () => {
  it('the DM and one player hear only each other; the rest of the table loses the DM and that player', () => {
    const s = fresh();
    s.startAside('dm', 'alice');
    expect(s.hears('alice', 'dm', DM)).toBe(true);
    expect(s.hears('dm', 'alice', DM)).toBe(true);
    expect(s.hears('dm', 'bob', DM)).toBe(false); // the DM hears nothing from the table
    expect(s.hears('bob', 'dm', DM)).toBe(false); // and the table does not hear the DM
    expect(s.hears('alice', 'bob', DM)).toBe(false);
    expect(s.hears('bob', 'alice', DM)).toBe(false); // nor the player
    expect(s.hears('bob', 'carol', DM)).toBe(true); // the others carry on among themselves
    expect(s.snapshot().aside).toEqual({ dmId: 'dm', playerId: 'alice' });
  });

  it('beats the groups: a player in a party still hears only the DM', () => {
    const s = fresh();
    const a = s.create('Cellar');
    s.move('alice', a.id);
    s.move('bob', a.id);
    s.startAside('dm', 'alice');
    expect(s.hears('bob', 'alice', DM)).toBe(false); // same party, but alice is in the aside
    expect(s.hears('alice', 'dm', DM)).toBe(true);
  });

  it('ending it, a reset, or either person leaving restores normal hearing', () => {
    const s = fresh();
    s.startAside('dm', 'alice');
    s.endAside();
    expect(s.aside).toBeNull();
    expect(s.hears('dm', 'bob', DM)).toBe(true);
    s.startAside('dm', 'alice');
    s.reset();
    expect(s.aside).toBeNull();
    s.startAside('dm', 'alice');
    s.forget('alice');
    expect(s.aside).toBeNull();
    expect(s.restricted).toBe(false);
  });
});
