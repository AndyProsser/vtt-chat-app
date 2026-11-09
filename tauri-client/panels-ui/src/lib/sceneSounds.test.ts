import { describe, expect, it } from 'vitest';

import { soundsFor } from './sceneSounds.js';

const sounds = [
  { id: '1', name: 'Door open', category: 'effect' },
  { id: '2', name: 'Crowd murmur', category: 'ambience' },
  { id: '3', name: 'Tavern song', category: 'music' },
  { id: '4', name: 'Coins', category: 'effect' },
];

describe('soundsFor', () => {
  it('offers ambience and music for a loop', () => {
    expect(soundsFor('loop', sounds).map((s) => s.id)).toEqual(['2', '3']);
  });
  it('offers the stingers (effects) for a random layer', () => {
    expect(soundsFor('random', sounds).map((s) => s.id)).toEqual(['1', '4']);
  });
  it('treats a sound with no category as an effect', () => {
    expect(soundsFor('random', [{ id: 'x', name: 'X' }]).map((s) => s.id)).toEqual(['x']);
    expect(soundsFor('loop', [{ id: 'x', name: 'X' }])).toEqual([]);
  });
});
