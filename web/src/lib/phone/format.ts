import type { RsvpStatus } from '../../types/phone.js';

export const RSVP_LABEL: Record<RsvpStatus, string> = {
  yes: 'Can make it',
  late: 'Running late',
  no: 'Can’t make it',
};

/** "Thu 12 Nov, 7:00 pm to 10:00 pm", in the viewer's own time. */
export function sessionWhen(startsAt: number, durationMinutes: number, locale?: string): string {
  const start = new Date(startsAt);
  const end = new Date(startsAt + durationMinutes * 60_000);
  const day = start.toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = (d: Date) => d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time(start)} to ${time(end)}`;
}

/** "in 3 days", "in 2 hours", "started 1 hour ago": how far a session is, in the largest fitting unit. */
export function sessionDistance(startsAt: number, now: number): string {
  const diff = startsAt - now;
  const abs = Math.abs(diff);
  const unit =
    abs >= 86_400_000
      ? [86_400_000, 'day']
      : abs >= 3_600_000
        ? [3_600_000, 'hour']
        : [60_000, 'minute'];
  const n = Math.max(1, Math.round(abs / (unit[0] as number)));
  const label = `${n} ${unit[1]}${n === 1 ? '' : 's'}`;
  return diff >= 0 ? `in ${label}` : `started ${label} ago`;
}

/** The time a chat line was written: the clock today, the date and clock otherwise. */
export function lineTime(at: number, now: number, locale?: string): string {
  const d = new Date(at);
  const clock = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === new Date(now).toDateString();
  return sameDay
    ? clock
    : `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}, ${clock}`;
}

/** A recording's title: the date and, when it has both ends, how long it ran. */
export function recordingTitle(
  startedAt: number,
  stoppedAt: number | null,
  locale?: string,
): string {
  const day = new Date(startedAt).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  if (stoppedAt === null) return day;
  const minutes = Math.max(1, Math.round((stoppedAt - startedAt) / 60_000));
  const h = Math.floor(minutes / 60);
  return `${day} · ${h > 0 ? `${h} h ` : ''}${minutes % 60} min`;
}

/** Utterance time in a transcript, as m:ss or h:mm:ss. */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
