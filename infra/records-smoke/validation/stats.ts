// Small statistics for the report: summaries of a series, and percentiles (nearest rank, so a value is always one that was seen).

export interface Summary {
  n: number;
  min: number;
  mean: number;
  p95: number;
  max: number;
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

export function summarise(values: readonly (number | undefined)[]): Summary | undefined {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0) return undefined;
  const sorted = [...v].sort((a, b) => a - b);
  return {
    n: v.length,
    min: sorted[0] as number,
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] as number,
  };
}

export const fmtBytes = (n: number | undefined): string => {
  if (n === undefined || !Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  if (abs >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GiB`;
  if (abs >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  if (abs >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${Math.round(n)} B`;
};

export const fmtRate = (bytesPerSec: number | undefined): string =>
  bytesPerSec === undefined || !Number.isFinite(bytesPerSec) ? '–' : `${fmtBytes(bytesPerSec)}/s`;

export const fmtNum = (n: number | undefined, digits = 1): string =>
  n === undefined || !Number.isFinite(n) ? '–' : n.toFixed(digits);

export const fmtDuration = (sec: number): string => {
  const s = Math.round(sec);
  if (s < 90) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 90 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
