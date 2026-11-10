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
