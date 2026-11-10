/** The at-a-glance numbers, worked out from the sheet by us (D&D Beyond does not send them finished). */
export interface DdbSheet {
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  maxHp: number;
  armorClass: number;
  passivePerception: number;
}

/** What a sync brings back. */
export interface DdbCharacter {
  name: string;
  race: string | null;
  className: string | null;
  level: number | null;
  /** An https address on D&D Beyond's image hosts, or null when there is no portrait. */
  portraitUrl: string | null;
  /** Ability scores, max HP, AC and passive perception; null when the reply has no ability scores. */
  sheet: DdbSheet | null;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
