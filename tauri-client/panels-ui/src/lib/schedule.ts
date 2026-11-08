/** Half-hour slots of a day as `HH:MM`. */
export const TIME_OPTIONS: readonly string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  return `${h}:${i % 2 === 0 ? '00' : '30'}`;
});

/** Session lengths in minutes: 30 minutes to 8 hours, in half hours. */
export const DURATION_OPTIONS: readonly number[] = Array.from(
  { length: 16 },
  (_, i) => (i + 1) * 30,
);

export const DEFAULT_DURATION = 180;

const pad = (n: number) => String(n).padStart(2, '0');
const dateString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "Session N": one more than the highest number already in a title, else one more than the count. */
export function nextSessionTitle(titles: string[]): string {
  const numbers = titles
    .map((t) => /^session\s+(\d+)/i.exec(t.trim())?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  return `Session ${numbers.length > 0 ? Math.max(...numbers) + 1 : titles.length + 1}`;
}

/** The next half hour after `now`, as a local date and time for the pickers. */
export function defaultSlot(now: Date): { date: string; time: string } {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(now.getMinutes() < 30 ? 30 : 60);
  return { date: dateString(next), time: `${pad(next.getHours())}:${pad(next.getMinutes())}` };
}

/** The instant (epoch ms) of a local `YYYY-MM-DD` and `HH:MM`, or `undefined` if either is not valid. */
export function startsAtOf(date: string, time: string): number | undefined {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return undefined;
  const when = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  return Number.isNaN(when.getTime()) ? undefined : when.getTime();
}

/** "Wed 11 Nov, 7:00 pm – 10:00 pm"; the finish names its day if it is not the start's day. */
export function formatRange(startsAt: number, durationMinutes: number, locale?: string): string {
  const start = new Date(startsAt);
  const end = new Date(startsAt + durationMinutes * 60_000);
  const day = (d: Date) =>
    d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const clock = (d: Date) => d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const sameDay = dateString(start) === dateString(end);
  return `${day(start)}, ${clock(start)} – ${sameDay ? '' : `${day(end)}, `}${clock(end)}`;
}
