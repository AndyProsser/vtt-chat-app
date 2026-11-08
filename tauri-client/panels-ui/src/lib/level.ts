/** How many of `bars` to light for a 0..1 `level`; clamps, and treats NaN as silence. */
export function levelToBars(level: number, bars = 8): number {
  if (!Number.isFinite(level)) return 0;
  return Math.round(Math.min(1, Math.max(0, level)) * bars);
}
