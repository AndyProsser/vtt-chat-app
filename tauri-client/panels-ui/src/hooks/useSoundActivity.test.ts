import { describe, expect, it } from 'vitest';

import { activityTotal } from './useSoundActivity.js';

describe('activityTotal', () => {
  it('adds what is sounding on the deck: a voice, the stingers and a scene', () => {
    expect(activityTotal({ voice: 0, stingers: 0, scenes: 0 })).toBe(0);
    expect(activityTotal({ voice: 1, stingers: 3, scenes: 1 })).toBe(5);
  });
});
