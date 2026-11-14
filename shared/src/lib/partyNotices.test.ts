import { describe, expect, it } from 'vitest';

import { describePartyChange, type PartyStateLike } from './partyNotices.js';

const name = (id: string) => ({ a: 'Aria', b: 'Bram', c: 'Cade' })[id] ?? id;
const none: PartyStateLike = { parties: [], assignments: {} };
const cellar = { id: 'g1', name: 'Cellar' };
const roof = { id: 'g2', name: 'Roof' };

describe('describePartyChange', () => {
  it('says nothing when nothing changed', () => {
    expect(describePartyChange(none, none, name)).toEqual([]);
  });
  it('names who joined a group, who moved between groups, and who went back to the table', () => {
    const one: PartyStateLike = { parties: [cellar, roof], assignments: { a: 'g1' } };
    expect(describePartyChange(none, one, name)).toEqual(['Aria joined Cellar']);
    const two: PartyStateLike = { parties: [cellar, roof], assignments: { a: 'g2', b: 'g1' } };
    expect(describePartyChange(one, two, name)).toEqual([
      'Aria moved from Cellar to Roof',
      'Bram joined Cellar',
    ]);
    const back: PartyStateLike = { parties: [cellar, roof], assignments: { b: 'g1' } };
    expect(describePartyChange(two, back, name)).toEqual(['Aria rejoined the main table']);
  });
  it('one line when the whole split ends', () => {
    const split: PartyStateLike = { parties: [cellar], assignments: { a: 'g1', b: 'g1' } };
    expect(describePartyChange(split, none, name)).toEqual(['The table is together again']);
  });
  it('announces a private talk starting, changing person and ending', () => {
    const talk = (p: string): PartyStateLike => ({
      parties: [],
      assignments: {},
      aside: { dmId: 'dm', playerId: p },
    });
    expect(describePartyChange(none, talk('a'), name)).toEqual([
      'The DM took Aria aside for a private talk',
    ]);
    expect(describePartyChange(talk('a'), talk('b'), name)).toEqual([
      'The DM took Bram aside for a private talk',
    ]);
    expect(describePartyChange(talk('b'), none, name)).toEqual(['The private talk ended']);
  });
});
