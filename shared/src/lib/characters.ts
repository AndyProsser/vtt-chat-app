/** A character as the server returns it for the signed-in player in one campaign. */
export interface CharacterRecord {
  id: string;
  name: string;
  className: string | null;
  race: string | null;
  level: number | null;
  avatarUrl: string | null;
  /** The D&D Beyond sheet it is linked to, if any, and when it was last read (epoch ms). */
  sourceUrl?: string | null;
  syncedAt?: number | null;
  /** Worked out from the linked sheet by the server; absent until a sync has read one. */
  sheet?: CharacterSheet | null;
}

export interface CharacterSheet {
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  maxHp: number;
  armorClass: number;
  passivePerception: number;
  /** Special senses with their range in feet; absent on a sheet last read before 0.6. */
  senses?: CharacterSense[];
  /** Each class with its level and subclass; absent on a sheet last read before 0.6. */
  classes?: CharacterClass[];
}

export type SenseKind = 'darkvision' | 'blindsight' | 'tremorsense' | 'truesight';

export interface CharacterSense {
  kind: SenseKind;
  /** Feet. */
  range: number;
}

export interface CharacterClass {
  name: string;
  level: number;
  subclass: string | null;
}

export const SENSE_LABELS: Record<SenseKind, string> = {
  darkvision: 'Darkvision',
  blindsight: 'Blindsight',
  tremorsense: 'Tremorsense',
  truesight: 'Truesight',
};

/** "Darkvision 60 ft", for a tooltip or a list. */
export const senseLabel = (s: CharacterSense): string => `${SENSE_LABELS[s.kind]} ${s.range} ft`;

/**
 * "Monk 5 (Way of the Open Hand) / Cleric 4 (Life Domain)": the classes as the character screens and the detail popup
 * write them. A class with no subclass yet is just "Wizard 1". Null when the sheet predates class detail.
 */
export function classesLine(sheet: CharacterSheet | null | undefined): string | null {
  const classes = sheet?.classes;
  if (!classes || classes.length === 0) return null;
  return classes
    .map((c) => `${c.name} ${c.level}${c.subclass ? ` (${c.subclass})` : ''}`)
    .join(' / ');
}

/** "AC 16 · HP 50 · Passive Perception 11", or null with no sheet. */
export function vitalsLine(sheet: CharacterSheet | null | undefined): string | null {
  if (!sheet) return null;
  return `AC ${sheet.armorClass} · HP ${sheet.maxHp} · Passive Perception ${sheet.passivePerception}`;
}

/** "STR 16 (+3) · DEX 14 (+2) · …", or null with no sheet. */
export function abilityLine(sheet: CharacterSheet | null | undefined): string | null {
  if (!sheet) return null;
  const entries = Object.entries(sheet.abilities) as [string, number][];
  return entries
    .map(([k, v]) => {
      const m = Math.floor((v - 10) / 2);
      return `${k.toUpperCase()} ${v} (${m >= 0 ? '+' : '-'}${Math.abs(m)})`;
    })
    .join(' · ');
}

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

/** "+3", "+0", "-1": an ability score's modifier as the sheet writes it. */
export function modifier(score: number): string {
  const m = Math.floor((score - 10) / 2);
  return `${m >= 0 ? '+' : '-'}${Math.abs(m)}`;
}

/** One number on a character screen: a small label, the figure, and optionally a smaller figure under it. */
export interface StatTile {
  key: string;
  label: string;
  value: string;
  sub?: string;
}

/** The six abilities in the sheet's own order (the database does not keep key order), modifier large, score small. */
export function abilityTiles(sheet: CharacterSheet | null | undefined): StatTile[] {
  if (!sheet) return [];
  return ABILITY_KEYS.map((key) => ({
    key,
    label: key.toUpperCase(),
    value: modifier(sheet.abilities[key]),
    sub: String(sheet.abilities[key]),
  }));
}

/** Armour class, hit points and passive perception, for the row of tiles above the abilities. */
export function vitalTiles(sheet: CharacterSheet | null | undefined): StatTile[] {
  if (!sheet) return [];
  return [
    { key: 'ac', label: 'AC', value: String(sheet.armorClass) },
    { key: 'hp', label: 'HP', value: String(sheet.maxHp) },
    { key: 'pp', label: 'Passive Perception', value: String(sheet.passivePerception) },
  ];
}

/** "Aasimar · Sorcerer · level 5": only the parts that exist. */
export function characterDetails(c: Pick<CharacterRecord, 'race' | 'className' | 'level'>): string {
  return [c.race, c.className, c.level ? `level ${c.level}` : null].filter(Boolean).join(' · ');
}

/** The name a character gets while its D&D Beyond link is being read (the sheet then replaces it). */
export const NEW_CHARACTER_NAME = 'New character';

/** What the form holds while editing: text fields, so a half-typed level is still just text. */
export interface CharacterDraft {
  name: string;
  className: string;
  race: string;
  level: string;
  avatarUrl: string | null;
}

export const draftOf = (c: CharacterRecord): CharacterDraft => ({
  name: c.name,
  className: c.className ?? '',
  race: c.race ?? '',
  level: c.level === null ? '' : String(c.level),
  avatarUrl: c.avatarUrl,
});

export const blankDraft = (): CharacterDraft => ({
  name: '',
  className: '',
  race: '',
  level: '1',
  avatarUrl: null,
});

/** The PATCH body: only the fields that differ from `original`. A level that is not a number is left out. */
export function characterPatch(
  original: CharacterRecord,
  draft: CharacterDraft,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const name = draft.name.trim();
  if (name !== original.name) patch.name = name;
  for (const key of ['className', 'race'] as const) {
    const value = draft[key].trim() || null;
    if (value !== original[key]) patch[key] = value;
  }
  const levelText = draft.level.trim();
  if (levelText === '') {
    if (original.level !== null) patch.level = null;
  } else if (/^\d+$/.test(levelText) && Number(levelText) !== original.level) {
    patch.level = Number(levelText);
  }
  if (draft.avatarUrl !== original.avatarUrl) patch.avatarUrl = draft.avatarUrl;
  return patch;
}

/** The few calls adding a character needs, so the two apps (and the tests) can share the steps. */
export interface NewCharacterApi {
  create(fields: Record<string, unknown>): Promise<string>;
  update(id: string, fields: Record<string, unknown>): Promise<unknown>;
  link(id: string, url: string): Promise<unknown>;
}

/** The create/update body for a hand-filled draft: blanks as null, a level that is not a number as null. */
export function newCharacterFields(draft: CharacterDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    className: draft.className.trim() || null,
    race: draft.race.trim() || null,
    level: /^\d+$/.test(draft.level) ? Number(draft.level) : null,
  };
}

/**
 * Adds a character from a D&D Beyond sheet link. The server links an existing character (a one-step route is a
 * 0.6.0 item), so this makes a placeholder first and links it. `madeId` is the placeholder from an earlier failed
 * try, reused so trying again does not make a second one; `onMade` reports the id as soon as it exists.
 */
export async function createFromSheet(
  api: NewCharacterApi,
  url: string,
  madeId?: string,
  onMade?: (id: string) => void,
): Promise<string> {
  let id = madeId;
  if (!id) {
    id = await api.create({ name: NEW_CHARACTER_NAME });
    onMade?.(id);
  }
  await api.link(id, url);
  return id;
}

/** Adds a hand-filled character, or fills in the placeholder a failed link left behind. */
export async function createByHand(
  api: NewCharacterApi,
  draft: CharacterDraft,
  madeId?: string,
): Promise<string> {
  const fields = newCharacterFields(draft);
  if (madeId) {
    await api.update(madeId, fields);
    return madeId;
  }
  return api.create(fields);
}
