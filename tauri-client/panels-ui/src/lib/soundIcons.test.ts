import { DoorClosed, DoorOpen, Footprints, Coins, Volume2, Hammer, Sparkles } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { boardIcon, soundIcon } from './soundIcons.js';

describe('sound icons', () => {
  it('picks a board icon from the board name, ignoring case', () => {
    expect(boardIcon('Door')).toBe(DoorOpen);
    expect(boardIcon('footstep')).toBe(Footprints);
    expect(boardIcon('Impact')).toBe(Hammer);
  });

  it('falls back to a generic icon for an unknown board', () => {
    expect(boardIcon('Tavern ambience')).toBe(Sparkles);
  });

  it('picks a sound icon from its label', () => {
    expect(soundIcon('close')).toBe(DoorClosed);
    expect(soundIcon('open')).toBe(DoorOpen);
    expect(soundIcon('coins')).toBe(Coins);
  });

  it('falls back to the speaker for an unknown sound', () => {
    expect(soundIcon('zzz')).toBe(Volume2);
  });
});
