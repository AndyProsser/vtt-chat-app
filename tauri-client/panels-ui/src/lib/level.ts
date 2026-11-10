/** How many of `bars` to light for a 0..1 `level`; clamps, and treats NaN as silence. */
export function levelToBars(level: number, bars = 8): number {
  if (!Number.isFinite(level)) return 0;
  return Math.round(Math.min(1, Math.max(0, level)) * bars);
}

export type BarZone = 'ok' | 'warm' | 'hot';

/** The colour band of a bar, counting from the bottom (1 = lowest): green, amber near the top, red for the last. */
export function barZone(position: number, bars = 8): BarZone {
  if (position >= bars) return 'hot';
  return position / bars > 0.65 ? 'warm' : 'ok';
}
