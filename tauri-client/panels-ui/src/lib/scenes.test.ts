import { describe, expect, it } from 'vitest';

import type { SoundScene } from '../types/index.js';
import { defaultShownScenes, searchScenes } from './scenes.js';

const scenes = ['Rainfall', 'Forest', 'Tavern', 'Market', 'Battle', 'Cave', 'Dungeon'].map(
  (name): SoundScene => ({ id: name.toLowerCase(), name, layers: [] }),
);

describe('scenes', () => {
  it('shows the first six on a fresh deck', () => {
    expect(defaultShownScenes(scenes)).toEqual([
      'rainfall',
      'forest',
      'tavern',
      'market',
      'battle',
      'cave',
    ]);
  });
  it('searches by name, ignoring case; no text lists everything', () => {
    expect(searchScenes(scenes, ' TAV ').map((s) => s.id)).toEqual(['tavern']);
    expect(searchScenes(scenes, '')).toHaveLength(7);
  });
});
