/** Pure helpers for the date picker. Dates travel as `YYYY-MM-DD` strings, the same shape `<input type="date">` used. */
const pad = (n: number) => String(n).padStart(2, '0');

export const toIso = (year: number, month: number, day: number): string =>
  `${year}-${pad(month + 1)}-${pad(day)}`;

export function parseIso(iso: string): { year: number; month: number; day: number } | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

/** The cells of one month as rows of seven, weeks starting on Monday; `null` pads the edges. */
export function monthGrid(year: number, month: number): (number | null)[][] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** Month `delta` away from (year, month), rolling the year over. */
export function shiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + month + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}
