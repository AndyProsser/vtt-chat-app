import { describe, expect, it } from 'vitest';

import {
  abilityLine,
  createByHand,
  createFromSheet,
  NEW_CHARACTER_NAME,
  type NewCharacterApi,
  abilityTiles,
  characterDetails,
  modifier,
  vitalTiles,
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

describe('sheet tiles', () => {
  const sheet = {
    // Out of order on purpose: a database does not keep key order.
    abilities: { cha: 16, con: 12, dex: 16, int: 10, str: 8, wis: 14 },
    maxHp: 32,
    armorClass: 16,
    passivePerception: 12,
  };
  it('writes modifiers the way the sheet does', () => {
    expect([8, 10, 11, 12, 16, 20].map(modifier)).toEqual(['-1', '+0', '+0', '+1', '+3', '+5']);
  });
  it('lists the six abilities in the sheet order, modifier first and score under it', () => {
    expect(abilityTiles(sheet).map((t) => `${t.label} ${t.value} ${t.sub}`)).toEqual([
      'STR -1 8',
      'DEX +3 16',
      'CON +1 12',
      'INT +0 10',
      'WIS +2 14',
      'CHA +3 16',
    ]);
    expect(abilityTiles(null)).toEqual([]);
  });
  it('gives AC, HP and passive perception, and nothing without a sheet', () => {
    expect(vitalTiles(sheet).map((t) => `${t.label} ${t.value}`)).toEqual([
      'AC 16',
      'HP 32',
      'Passive Perception 12',
    ]);
    expect(vitalTiles(undefined)).toEqual([]);
  });
  it('describes a character with only the parts it has', () => {
    expect(characterDetails({ race: 'Aasimar', className: 'Sorcerer', level: 5 })).toBe(
      'Aasimar · Sorcerer · level 5',
    );
    expect(characterDetails({ race: null, className: null, level: null })).toBe('');
  });
});

describe('adding a character', () => {
  const fake = (failLink = false) => {
    const calls: string[] = [];
    const api: NewCharacterApi = {
      create: async (f) => (calls.push(`create ${JSON.stringify(f)}`), 'id1'),
      update: async (id, f) => void calls.push(`update ${id} ${JSON.stringify(f)}`),
      link: async (id, url) => {
        calls.push(`link ${id} ${url}`);
        if (failLink) throw new Error('private');
      },
    };
    return { api, calls };
  };
  it('makes a placeholder and links it', async () => {
    const { api, calls } = fake();
    expect(await createFromSheet(api, 'U')).toBe('id1');
    expect(calls).toEqual([`create {"name":"${NEW_CHARACTER_NAME}"}`, 'link id1 U']);
  });
  it('reuses the placeholder after a failed link, then fills it in by hand', async () => {
    const failing = fake(true);
    let made: string | undefined;
    await expect(
      createFromSheet(failing.api, 'U', undefined, (id) => (made = id)),
    ).rejects.toThrow();
    expect(made).toBe('id1');
    const retry = fake();
    await createFromSheet(retry.api, 'U', made);
    expect(retry.calls).toEqual(['link id1 U']); // no second character
    const hand = fake();
    await createByHand(hand.api, { ...blankDraft(), name: ' Bo ', level: 'x' }, made);
    expect(hand.calls).toEqual([
      'update id1 {"name":"Bo","className":null,"race":null,"level":null}',
    ]);
  });
  it('creates a hand-made character when there is no placeholder', async () => {
    const { api, calls } = fake();
    await createByHand(api, { ...blankDraft(), name: 'Bo', level: '4', race: 'Elf' });
    expect(calls).toEqual(['create {"name":"Bo","className":null,"race":"Elf","level":4}']);
  });
});
