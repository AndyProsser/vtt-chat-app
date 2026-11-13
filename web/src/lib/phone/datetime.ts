/**
 * Dates for the schedule form. The API speaks epoch milliseconds; a `datetime-local` input speaks
 * `YYYY-MM-DDTHH:mm` in the viewer's own zone. These helpers convert between the two and say so plainly when
 * a typed time cannot exist (the hour a clock skips on the night it springs forward).
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** The `datetime-local` value of an instant, in the viewer's local time (no seconds). */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type LocalParse =
  { ok: true; ms: number } | { ok: false; reason: 'invalid' | 'nonexistent' };

/**
 * The instant of a local `YYYY-MM-DDTHH:mm`. `invalid` is anything that is not a real calendar date and clock;
 * `nonexistent` is a local time that the zone skips (clocks go forward). A time that happens twice (clocks go
 * back) is read as its first occurrence.
 */
export function parseLocalInput(value: string): LocalParse {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return { ok: false, reason: 'invalid' };
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) {
    return { ok: false, reason: 'invalid' };
  }
  const when = new Date(year, month - 1, day, hour, minute);
  if (Number.isNaN(when.getTime())) return { ok: false, reason: 'invalid' };
  // 31 February rolls over to March: not a date.
  if (when.getFullYear() !== year || when.getMonth() !== month - 1 || when.getDate() !== day) {
    return { ok: false, reason: 'invalid' };
  }
  // A skipped hour is moved forward by the Date constructor, so it does not read back as typed.
  if (when.getHours() !== hour || when.getMinutes() !== minute) {
    return { ok: false, reason: 'nonexistent' };
  }
  return { ok: true, ms: when.getTime() };
}

/** The next half hour after `now`: where a new session's time starts. */
export function defaultStart(now: number): number {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d.getTime();
}

/** "Australia/Perth (AWST)": the zone the time is read in, so a DM travelling or a phone on the wrong zone is obvious. */
export function zoneLabel(at: number, locale?: string): string {
  const name = Intl.DateTimeFormat(locale).resolvedOptions().timeZone;
  const short = new Intl.DateTimeFormat(locale, { timeZoneName: 'short' })
    .formatToParts(new Date(at))
    .find((p) => p.type === 'timeZoneName')?.value;
  return short && name ? `${name} (${short})` : (name ?? short ?? 'your local time');
}
