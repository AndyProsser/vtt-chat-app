export interface SoundLevels {
  stingers: number;
  scenes: number;
}

/** Scenes sit under stingers, so a door slam is heard over the tavern. */
export const DEFAULT_LEVELS: SoundLevels = { stingers: 0.85, scenes: 0.55 };

export function parseLevels(raw: string | null): SoundLevels {
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : undefined;
  } catch {
    value = undefined;
  }
  const saved =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const pick = (name: keyof SoundLevels) => {
    const v = saved[name];
    return typeof v === 'number' && Number.isFinite(v)
      ? Math.min(1, Math.max(0, v))
      : DEFAULT_LEVELS[name];
  };
  return { stingers: pick('stingers'), scenes: pick('scenes') };
}
