/**
 * The next session of a table, for the campaign switcher in both apps: which upcoming session to show, and how to say
 * when it is. Pure and shared so the desktop and phone apps agree. Not a wire contract: it reads what the sessions
 * route already returns.
 */

export type RsvpChoice = 'yes' | 'late' | 'no';

/** What the helper needs of a session as `GET /api/campaigns/:id/sessions` returns it. */
export interface SessionLike {
  session: { id: string; startsAt: number; title: string; cancelledAt: number | null };
  mine: RsvpChoice | null;
}

/** A session still counts as "next" for this long after it starts, so a session in progress is not skipped. */
export const NEXT_SESSION_GRACE_MS = 4 * 60 * 60_000;

/** The earliest session that has not been cancelled and has not ended (within the grace), or undefined. */
export function nextSession<T extends SessionLike>(
  sessions: readonly T[],
  now: number,
  graceMs: number = NEXT_SESSION_GRACE_MS,
): T | undefined {
  let best: T | undefined;
  for (const s of sessions) {
    if (s.session.cancelledAt !== null || s.session.startsAt + graceMs < now) continue;
    if (best === undefined || s.session.startsAt < best.session.startsAt) best = s;
  }
  return best;
}

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * "Today, 7:30 pm", "Tomorrow, 7:30 pm", "Sat 7:30 pm" (within the next week), or "Sat 22 Nov, 7:30 pm";
 * "Now" for a session that has started and is inside the grace. Local time of the machine it runs on.
 */
export function whenLabel(startsAt: number, now: number, locale?: string): string {
  const clock = new Date(startsAt).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (startsAt <= now) return 'Now';
  const days = Math.round((startOfDay(startsAt) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return `Today, ${clock}`;
  if (days === 1) return `Tomorrow, ${clock}`;
  const weekday = new Date(startsAt).toLocaleDateString(locale, { weekday: 'short' });
  if (days < 7) return `${weekday} ${clock}`;
  const date = new Date(startsAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return `${weekday} ${date}, ${clock}`;
}

export const RSVP_CHOICES: readonly { status: RsvpChoice; label: string }[] = [
  { status: 'yes', label: 'Can make it' },
  { status: 'late', label: 'Running late' },
  { status: 'no', label: "Can't make it" },
];
