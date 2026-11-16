import { CloudRain, Clapperboard, Beer, Swords, TreePine } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { sceneIcon } from './sceneIcons.js';

describe('sceneIcon', () => {
  it('picks an icon from the scene name, ignoring case', () => {
    expect(sceneIcon('Rainfall')).toBe(CloudRain);
    expect(sceneIcon('Forest at dawn')).toBe(TreePine);
    expect(sceneIcon('Busy TAVERN')).toBe(Beer);
    expect(sceneIcon('Battle / fight')).toBe(Swords);
  });
  it('does not match short words inside longer ones', () => {
    expect(sceneIcon('Winner celebration')).toBe(Clapperboard);
    expect(sceneIcon('The inn')).toBe(Beer);
  });
  it('falls back to a generic scene icon', () => {
    expect(sceneIcon('Zzz')).toBe(Clapperboard);
  });
});
