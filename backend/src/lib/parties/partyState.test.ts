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
    expect(s.snapshot()).toEqual({ parties: [], assignments: {}, split: false });
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
