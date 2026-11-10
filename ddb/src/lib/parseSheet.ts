import type { DdbSheet } from '../types/index.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const mod = (score: number) => Math.floor((score - 10) / 2);

interface Modifier {
  type: string;
  subType: string;
  value: number | null;
  statId: number | null;
}

function allModifiers(data: Record<string, unknown>): Modifier[] {
  if (!isRecord(data.modifiers)) return [];
  return Object.values(data.modifiers)
    .flatMap((group) => (Array.isArray(group) ? group : []))
    .filter(isRecord)
    .map((m) => ({
      type: typeof m.type === 'string' ? m.type : '',
      subType: typeof m.subType === 'string' ? m.subType : '',
      value: num(m.value) ?? num(m.fixedValue),
      statId: num(m.statId),
    }));
}

/** The value for stat `id` (1 to 6) in one of D&D Beyond's `[{ id, value }]` lists, or null. */
function statValue(list: unknown, id: number): number | null {
  if (!Array.isArray(list)) return null;
  const entry = list.filter(isRecord).find((e) => e.id === id);
  return entry ? num(entry.value) : null;
}

/**
 * Works out the numbers the table wants at a glance (ability scores, max hit points, armor class,
 * passive perception) from the raw sheet. D&D Beyond does not send these finished, so this is our
 * arithmetic and can differ from the sheet in unusual builds (spell effects such as Mage Armor are
 * not modelled); the app says so wherever it shows them. Returns null when the ability scores are absent
 * rather than guessing.
 */
export function parseSheet(body: unknown): DdbSheet | null {
  if (!isRecord(body) || !Array.isArray(body.stats)) return null;
  const mods = allModifiers(body);

  const scores: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const base = statValue(body.stats, i + 1);
    if (base === null) return null;
    const override = statValue(body.overrideStats, i + 1);
    const bonusStat = statValue(body.bonusStats, i + 1) ?? 0;
    const sub = `${NAMES[i]}-score`;
    const bonus = mods
      .filter((m) => m.type === 'bonus' && m.subType === sub)
      .reduce((sum, m) => sum + (m.value ?? 0), 0);
    let score = override ?? base + bonusStat + bonus;
    // "Set" modifiers (e.g. a belt that makes Strength 19) only ever raise a score.
    for (const m of mods)
      if (m.type === 'set' && m.subType === sub && m.value !== null)
        score = Math.max(score, m.value);
    scores.push(score);
  }
  const abilities = Object.fromEntries(
    ABILITIES.map((a, i) => [a, scores[i]!]),
  ) as DdbSheet['abilities'];

  const level = (Array.isArray(body.classes) ? body.classes : [])
    .filter(isRecord)
    .reduce((sum, c) => sum + (num(c.level) ?? 0), 0);
  const proficiency = Math.ceil(Math.max(level, 1) / 4) + 1;

  // Features such as Draconic Resilience or the Tough feat add hit points for every level.
  const perLevelHp = mods
    .filter((m) => m.type === 'bonus' && m.subType === 'hit-points-per-level')
    .reduce((sum, m) => sum + (m.value ?? 0), 0);
  const override = num(body.overrideHitPoints);
  const maxHp =
    override ??
    (num(body.baseHitPoints) ?? 0) +
      (num(body.bonusHitPoints) ?? 0) +
      (mod(abilities.con) + perLevelHp) * level;

  const perception = mods.filter((m) => m.subType === 'perception');
  const proficient = perception.some((m) => m.type === 'proficiency');
  const expert = perception.some((m) => m.type === 'expertise');
  const passiveBonus = mods
    .filter((m) => m.type === 'bonus' && m.subType === 'passive-perception')
    .reduce((sum, m) => sum + (m.value ?? 0), 0);
  const passivePerception =
    10 +
    mod(abilities.wis) +
    (expert ? proficiency * 2 : proficient ? proficiency : 0) +
    passiveBonus;

  const worn = (Array.isArray(body.inventory) ? body.inventory : [])
    .filter(isRecord)
    .filter(
      (i) => i.equipped === true && isRecord(i.definition) && i.definition.filterType === 'Armor',
    )
    .map((i) => i.definition as Record<string, unknown>);
  const dex = mod(abilities.dex);
  let armorClass = 10 + dex;
  // Unarmored Defense (Barbarian, Monk) and Draconic Resilience name an ability to add to 10 + Dex.
  for (const m of mods)
    if (m.type === 'set' && m.subType === 'unarmored-armor-class' && m.statId !== null) {
      const ability = scores[m.statId - 1];
      if (ability !== undefined) armorClass = Math.max(armorClass, 10 + dex + mod(ability));
    }
  const body_ = worn.find((d) => d.armorTypeId !== 4);
  if (body_) {
    const ac = num(body_.armorClass) ?? 10;
    armorClass =
      body_.armorTypeId === 1 ? ac + dex : body_.armorTypeId === 2 ? ac + Math.min(dex, 2) : ac;
  }
  const shield = worn.find((d) => d.armorTypeId === 4);
  if (shield) armorClass += num(shield.armorClass) ?? 2;
  armorClass += mods
    .filter((m) => m.type === 'bonus' && m.subType === 'armor-class')
    .reduce((sum, m) => sum + (m.value ?? 0), 0);

  return { abilities, maxHp, armorClass, passivePerception };
}
