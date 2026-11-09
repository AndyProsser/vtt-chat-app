/** What a sync brings back. Further fields (stats, AC, passive perception, max HP) are a later step. */
export interface DdbCharacter {
  name: string;
  race: string | null;
  className: string | null;
  level: number | null;
  /** An https address on D&D Beyond's image hosts, or null when there is no portrait. */
  portraitUrl: string | null;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
