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
