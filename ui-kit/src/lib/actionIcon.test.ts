import { describe, expect, it } from 'vitest';

import { actionIconName } from './actionIcon.js';

describe('actionIconName', () => {
  it('shows the skill icon when it cannot tell', () => {
    expect(actionIconName('contemplates the moon')).toBe('action');
    expect(actionIconName('')).toBe('action');
    expect(actionIconName('   ')).toBe('action');
  });

  it('reads the first word, and singular and plural (and -ing, -ed) are the same', () => {
    expect(actionIconName('jump')).toBe(actionIconName('jumps over the puddle'));
    expect(actionIconName('jumping')).toBe(actionIconName('jump'));
    expect(actionIconName('danced')).toBe(actionIconName('dance'));
    expect(actionIconName('dancing')).toBe(actionIconName('dances'));
    expect(actionIconName('hides')).toBe(actionIconName('hide'));
    expect(actionIconName('Laughs')).toBe(actionIconName('laugh'));
    expect(actionIconName('running')).toBe(actionIconName('runs'));
    expect(actionIconName('nods')).toBe(actionIconName('nod'));
    expect(actionIconName('nodded')).toBe(actionIconName('nod'));
  });

  it('knows the obvious ones', () => {
    const icon = actionIconName;
    expect(icon('shout "Charge!"')).toBe(icon('yell'));
    expect(icon('cast fireball')).toBe(icon('casts a spell'));
    expect(icon('take the coin purse')).toBe(icon('catch the apple'));
    for (const t of [
      'nods to the trader',
      'run to the door',
      'steal the purse',
      'points at the door',
      'sing a sea shanty',
      'snores loudly',
    ]) {
      expect(icon(t)).not.toBe('action');
    }
    // different actions get different pictures
    expect(
      new Set(['jump', 'dance', 'laugh', 'cast', 'hide', 'run', 'shout', 'steal', 'sing'].map(icon))
        .size,
    ).toBe(9);
  });

  it('is a best guess from the first word only', () => {
    expect(actionIconName('dive for cover')).toBe(actionIconName('jump'));
    expect(actionIconName('quietly jumps')).toBe('action');
  });

  it('ignores quotes and punctuation around the word', () => {
    expect(actionIconName('"jumps"')).toBe(actionIconName('jump'));
    expect(actionIconName('*dances*')).toBe(actionIconName('dance'));
  });
});
