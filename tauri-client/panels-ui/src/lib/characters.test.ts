import { describe, expect, it } from 'vitest';

import { blankDraft, characterPatch, draftOf, type CharacterRecord } from './characters.js';

const aria: CharacterRecord = {
  id: 'c1',
  name: 'Aria',
  className: 'Rogue',
  race: 'Elf',
  level: 3,
  avatarUrl: null,
};

describe('characterPatch', () => {
  it('sends nothing when nothing changed', () => {
    expect(characterPatch(aria, draftOf(aria))).toEqual({});
  });
  it('sends only what changed, with blanks as null and the level as a number', () => {
    const draft = {
      ...draftOf(aria),
      name: ' Aria Windfoot ',
      className: '',
      level: '4',
      avatarUrl: 'emblem:bow',
    };
    expect(characterPatch(aria, draft)).toEqual({
      name: 'Aria Windfoot',
      className: null,
      level: 4,
      avatarUrl: 'emblem:bow',
    });
  });
  it('treats a blank level as none, and reports a bad one by leaving it out of the patch as NaN-free', () => {
    expect(characterPatch(aria, { ...draftOf(aria), level: '' })).toEqual({ level: null });
    expect(characterPatch(aria, { ...draftOf(aria), level: 'x' })).toEqual({});
  });
});

describe('blankDraft', () => {
  it('starts a new character with level 1 and no emblem', () => {
    expect(blankDraft()).toEqual({
      name: '',
      className: '',
      race: '',
      level: '1',
      avatarUrl: null,
    });
  });
});
