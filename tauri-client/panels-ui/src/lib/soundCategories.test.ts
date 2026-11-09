import { describe, expect, it } from 'vitest';

import type { SoundBoard, SoundButton } from '../types/index.js';
import { categoriesOf } from './soundCategories.js';

const b = (label: string, mode: SoundButton['mode'] = 'oneshot'): SoundButton => ({
  id: label,
  label,
  soundId: label,
  mode,
  volume: 1,
  note: '',
});
const board = (name: string, ...buttons: SoundButton[]): SoundBoard => ({
  id: name,
  name,
  buttons,
});

describe('categoriesOf', () => {
  it('puts one-shot sounds in Environment and loops in Background', () => {
    const c = categoriesOf([board('Door', b('open'), b('rain', 'loop'))]);
    expect(c.environment.map((x) => [x.name, x.buttons.map((y) => y.label)])).toEqual([
      ['Door', ['open']],
    ]);
    expect(c.background.map((x) => [x.name, x.buttons.map((y) => y.label)])).toEqual([
      ['Door', ['rain']],
    ]);
  });

  it('puts boards named after creatures in Creatures, loops excepted', () => {
    const c = categoriesOf([board('Dragon roars', b('roar'), b('wind', 'loop'))]);
    expect(c.creatures.map((x) => x.buttons.length)).toEqual([1]);
    expect(c.background).toHaveLength(1);
    expect(c.environment).toEqual([]);
  });

  it('leaves out a board with nothing in a category', () => {
    const c = categoriesOf([board('Empty')]);
    expect(c).toEqual({ environment: [], background: [], creatures: [] });
  });
});
