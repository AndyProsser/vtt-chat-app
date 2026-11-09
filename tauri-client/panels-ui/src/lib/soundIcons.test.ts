import {
  Anvil,
  Axe,
  BookOpen,
  Bell,
  Coins,
  CookingPot,
  DoorClosed,
  DoorOpen,
  Drum,
  Fence,
  Footprints,
  HandMetal,
  Hammer,
  Layers,
  Lock,
  Pickaxe,
  Sparkles,
  Sprout,
  Sword,
  TreePine,
  Volume2,
  Wine,
  Zap,
} from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { boardIcon, soundIcon } from './soundIcons.js';

describe('board icons', () => {
  it('pick from the board name, ignoring case, with a fallback', () => {
    expect(boardIcon('Door')).toBe(DoorOpen);
    expect(boardIcon('footstep')).toBe(Footprints);
    expect(boardIcon('Tavern ambience')).toBe(Sparkles);
  });
});

describe('sound icons', () => {
  it('use the board as well as the label, so "close" is a door or a book as it should be', () => {
    expect(soundIcon('close', 'Door')).toBe(DoorClosed);
    expect(soundIcon('open', 'Door')).toBe(DoorOpen);
    expect(soundIcon('close', 'Book')).toBe(BookOpen);
  });

  it('give each footstep surface and each impact material its own icon', () => {
    expect(soundIcon('Footstep', 'Footstep')).toBe(Footprints);
    expect(soundIcon('grass', 'Footstep')).toBe(Sprout);
    expect(soundIcon('carpet', 'Footstep')).toBe(Layers);
    expect(soundIcon('wood', 'Footstep')).toBe(TreePine);
    expect(soundIcon('bell heavy', 'Impact')).toBe(Bell);
    expect(soundIcon('glass light', 'Impact')).toBe(Wine);
    expect(soundIcon('metal heavy', 'Impact')).toBe(Hammer);
    expect(soundIcon('mining', 'Impact')).toBe(Pickaxe);
    expect(soundIcon('plank medium', 'Impact')).toBe(Fence);
    expect(soundIcon('punch heavy', 'Impact')).toBe(HandMetal);
    expect(soundIcon('generic light', 'Impact')).toBe(Zap);
  });

  it('cover the odds and ends', () => {
    expect(soundIcon('coins', 'Handle')).toBe(Coins);
    expect(soundIcon('pot', 'Metal')).toBe(CookingPot);
    expect(soundIcon('latch', 'Metal')).toBe(Lock);
    expect(soundIcon('Chop', 'Misc')).toBe(Axe);
    expect(soundIcon('Draw knife', 'Misc')).toBe(Sword);
    expect(soundIcon('tin medium', 'Impact')).toBe(Drum);
    expect(soundIcon('plate heavy', 'Impact')).toBe(Anvil);
  });

  it('fall back to the speaker', () => {
    expect(soundIcon('zzz')).toBe(Volume2);
  });
});
