import { describe, expect, it } from 'vitest';

import { planBoards, planSounds, soundNameOf } from './importPlan.js';

describe('soundNameOf', () => {
  it('turns a file name into a readable sound name, dropping the take number', () => {
    expect(soundNameOf('impact_wood_medium_004.ogg')).toBe('Impact wood medium');
    expect(soundNameOf('addons/pack/door-creak 2.WAV')).toBe('Door creak');
    expect(soundNameOf('metal_pot_3.ogg')).toBe('Metal pot');
    expect(soundNameOf('bookClose.ogg')).toBe('BookClose');
  });
});

describe('planSounds', () => {
  it('groups numbered variants into one sound with several takes, keeping their order', () => {
    const plan = planSounds([
      'impact_wood_medium_002.ogg',
      'impact_wood_medium_001.ogg',
      'door_open.ogg',
      'impact_wood_medium_003.ogg',
    ]);
    expect(plan).toEqual([
      { name: 'Door open', files: ['door_open.ogg'] },
      {
        name: 'Impact wood medium',
        files: [
          'impact_wood_medium_001.ogg',
          'impact_wood_medium_002.ogg',
          'impact_wood_medium_003.ogg',
        ],
      },
    ]);
  });
  it('ignores files that are not audio', () => {
    expect(planSounds(['icon.png', 'LICENSE', 'a.ogg'])).toEqual([{ name: 'A', files: ['a.ogg'] }]);
  });
});

describe('planBoards', () => {
  const names = (list: string[]) => list.map((name) => ({ name }));
  it('makes a board per first word, with the rest of the name as the button label', () => {
    const boards = planBoards(
      names(['Impact wood', 'Impact metal', 'Door open', 'Door close', 'Door creak']),
    );
    expect(boards.map((b) => b.name)).toEqual(['Door', 'Impact']);
    expect(boards[0]!.buttons.map((b) => b.label)).toEqual(['close', 'creak', 'open']);
    expect(boards[0]!.buttons[0]!.soundName).toBe('Door close');
  });
  it('gathers lone sounds on a Misc board and splits a crowded board into parts of 60', () => {
    const many = Array.from(
      { length: 130 },
      (_, i) => `Impact thing ${String(i).padStart(3, '0')}`,
    );
    const boards = planBoards(names(['Bell', 'Knife', ...many]));
    expect(boards.find((b) => b.name === 'Misc')?.buttons).toHaveLength(2);
    const impact = boards.filter((b) => b.name.startsWith('Impact'));
    expect(impact.map((b) => b.buttons.length)).toEqual([60, 60, 10]);
    expect(impact.map((b) => b.name)).toEqual(['Impact', 'Impact 2', 'Impact 3']);
  });
});
