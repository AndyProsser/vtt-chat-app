import { describe, expect, it } from 'vitest';

import {
  abilityLine,
  blankDraft,
  characterPatch,
  draftOf,
  vitalsLine,
  type CharacterRecord,
} from './characters.js';

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

describe('the at-a-glance numbers from a linked sheet', () => {
  const sheet = {
    abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    maxHp: 50,
    armorClass: 16,
    passivePerception: 11,
  };
  it('puts armor class, hit points and passive perception on one line', () => {
    expect(vitalsLine(sheet)).toBe('AC 16 · HP 50 · Passive Perception 11');
  });
  it('shows each ability score with its modifier', () => {
    expect(abilityLine(sheet)).toBe(
      'STR 16 (+3) · DEX 14 (+2) · CON 14 (+2) · INT 10 (+0) · WIS 12 (+1) · CHA 8 (-1)',
    );
  });
  it('says nothing when there is no sheet', () => {
    expect(vitalsLine(null)).toBeNull();
    expect(abilityLine(undefined)).toBeNull();
  });
});
