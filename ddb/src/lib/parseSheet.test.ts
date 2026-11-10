import { describe, expect, it } from 'vitest';

import { parseSheet } from './parseSheet.js';

const stats = (str: number, dex: number, con: number, int: number, wis: number, cha: number) =>
  [str, dex, con, int, wis, cha].map((value, i) => ({ id: i + 1, value }));

/** A level 5 character: DEX 14 (+2), CON 14 (+2), WIS 12 (+1), a +1 racial bonus on CON. */
const base = () => ({
  classes: [{ level: 5, definition: { name: 'Fighter' } }],
  stats: stats(16, 14, 13, 10, 12, 8),
  bonusStats: [{ id: 3, value: null }],
  overrideStats: [{ id: 1, value: null }],
  baseHitPoints: 40,
  bonusHitPoints: null,
  overrideHitPoints: null,
  inventory: [],
  modifiers: {
    race: [{ type: 'bonus', subType: 'constitution-score', value: 1 }],
    class: [],
    background: [],
    item: [],
    feat: [],
    condition: [],
  },
});

describe('parseSheet', () => {
  it('works out ability scores, adding bonus modifiers and honouring overrides', () => {
    const sheet = parseSheet(base());
    expect(sheet?.abilities).toEqual({ str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 });

    const strong = base();
    strong.modifiers.item.push({ type: 'set', subType: 'strength-score', value: 19 });
    strong.overrideStats = [{ id: 2, value: 18 }];
    const s = parseSheet(strong);
    expect(s?.abilities.str).toBe(19);
    expect(s?.abilities.dex).toBe(18);
  });

  it('gives max hit points as base plus Constitution modifier per level, plus any bonus', () => {
    expect(parseSheet(base())?.maxHp).toBe(40 + 2 * 5);
    const bonus = { ...base(), bonusHitPoints: 5 };
    expect(parseSheet(bonus)?.maxHp).toBe(55);
    const overridden = { ...base(), overrideHitPoints: 99 };
    expect(parseSheet(overridden)?.maxHp).toBe(99);
  });

  it('works out passive perception from Wisdom, proficiency, expertise and bonuses', () => {
    expect(parseSheet(base())?.passivePerception).toBe(10 + 1);
    const proficient = base();
    proficient.modifiers.background.push({ type: 'proficiency', subType: 'perception' });
    expect(parseSheet(proficient)?.passivePerception).toBe(10 + 1 + 3);
    const expert = base();
    expert.modifiers.class.push({ type: 'proficiency', subType: 'perception' });
    expert.modifiers.class.push({ type: 'expertise', subType: 'perception' });
    expect(parseSheet(expert)?.passivePerception).toBe(10 + 1 + 6);
    const observant = base();
    observant.modifiers.feat.push({ type: 'bonus', subType: 'passive-perception', value: 5 });
    expect(parseSheet(observant)?.passivePerception).toBe(10 + 1 + 5);
  });

  it('works out armor class: unarmored, light, medium (Dexterity capped at 2), heavy, and a shield', () => {
    expect(parseSheet(base())?.armorClass).toBe(10 + 2);
    const armor = (armorClass: number, armorTypeId: number, equipped = true) => ({
      equipped,
      definition: { filterType: 'Armor', armorClass, armorTypeId },
    });
    const wear = (...items: ReturnType<typeof armor>[]) => ({ ...base(), inventory: items });
    expect(parseSheet(wear(armor(11, 1)))?.armorClass).toBe(11 + 2);
    expect(parseSheet(wear(armor(14, 2)))?.armorClass).toBe(14 + 2);
    const nimble = { ...wear(armor(14, 2)), stats: stats(16, 18, 13, 10, 12, 8) };
    expect(parseSheet(nimble)?.armorClass).toBe(14 + 2);
    expect(parseSheet(wear(armor(18, 3)))?.armorClass).toBe(18);
    expect(parseSheet(wear(armor(18, 3), armor(2, 4)))?.armorClass).toBe(20);
    expect(parseSheet(wear(armor(18, 3, false)))?.armorClass).toBe(12);
  });

  it('adds armor class bonuses from modifiers', () => {
    const ring = base();
    ring.modifiers.item.push({ type: 'bonus', subType: 'armor-class', value: 1 });
    expect(parseSheet(ring)?.armorClass).toBe(13);
  });

  it('gives nothing rather than a guess when the reply has no ability scores', () => {
    expect(parseSheet({ classes: [] })).toBeNull();
    expect(parseSheet(null)).toBeNull();
    expect(parseSheet({ ...base(), stats: [{ id: 1, value: 10 }] })).toBeNull();
  });

  // Liath, a level 5 Draconic Sorcerer (checked against the live sheet, D&D Beyond character 150276899):
  // Draconic Resilience gives +1 HP per level and an unarmored AC of 10 + Dex + Cha.
  const sorcerer = () => ({
    classes: [{ level: 5, definition: { name: 'Sorcerer' } }],
    stats: stats(8, 14, 12, 10, 13, 15),
    bonusStats: [],
    overrideStats: [],
    baseHitPoints: 22,
    bonusHitPoints: null,
    overrideHitPoints: null,
    inventory: [],
    modifiers: {
      race: [],
      class: [
        { type: 'bonus', subType: 'hit-points-per-level', value: 1 },
        { type: 'set', subType: 'unarmored-armor-class', value: null, statId: 6 },
      ],
      feat: [
        { type: 'bonus', subType: 'dexterity-score', value: 2 },
        { type: 'bonus', subType: 'wisdom-score', value: 1 },
        { type: 'bonus', subType: 'charisma-score', value: 1 },
      ],
      item: [],
    },
  });

  it('adds hit points per level from class features such as Draconic Resilience', () => {
    expect(parseSheet(sorcerer())?.maxHp).toBe(32); // 22 + 5 x CON(+1) + 5 x 1
  });

  it('uses an unarmored AC formula (10 + Dex + the named ability) when no armor is worn', () => {
    expect(parseSheet(sorcerer())?.armorClass).toBe(16); // 10 + 3 + 3
  });

  it('lets worn armor take over from the unarmored formula', () => {
    const worn = {
      ...sorcerer(),
      inventory: [
        { equipped: true, definition: { filterType: 'Armor', armorTypeId: 1, armorClass: 11 } },
      ],
    };
    expect(parseSheet(worn)?.armorClass).toBe(14); // leather 11 + Dex 3
  });
});
