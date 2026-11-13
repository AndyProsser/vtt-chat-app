import type { SessionItem } from '../../types/phone.js';
import { parseLocalInput, toLocalInput } from './datetime.js';

/** What the server accepts (scheduleService.ts / scheduleRoutes.ts). */
export const SESSION_LIMITS = { title: 200, notes: 2000, minMinutes: 15, maxMinutes: 720 } as const;
/** The server refuses a start more than this far in the past. */
const PAST_GRACE_MS = 5 * 60_000;
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60_000;

export const DEFAULT_DURATION = 180;

/** Session lengths offered, in minutes: 30 minutes to 8 hours, in half hours (as the desktop app). */
export const DURATION_OPTIONS: readonly number[] = Array.from(
  { length: 16 },
  (_, i) => (i + 1) * 30,
);

/** "3 h", "1 h 30", "45 min". */
export const durationLabel = (m: number): string =>
  m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60}`;

/** The offered lengths, plus this one when a session already has an unusual length. */
export function durationChoices(current: number): number[] {
  return DURATION_OPTIONS.includes(current)
    ? [...DURATION_OPTIONS]
    : [...DURATION_OPTIONS, current].sort((a, b) => a - b);
}

export interface SessionDraft {
  title: string;
  /** A `datetime-local` value. */
  start: string;
  duration: number;
  notes: string;
}

export interface SessionPayload {
  title: string;
  startsAt: number;
  durationMinutes: number;
  notes: string;
}

export type SessionField = 'title' | 'start' | 'duration' | 'notes';

/** "Session N": one more than the highest number already in a title, else one more than the count. */
export function nextSessionTitle(titles: string[]): string {
  const numbers = titles
    .map((t) => /^session\s+(\d+)/i.exec(t.trim())?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  return `Session ${numbers.length > 0 ? Math.max(...numbers) + 1 : titles.length + 1}`;
}

export function draftFromSession(session: SessionItem['session']): SessionDraft {
  return {
    title: session.title,
    start: toLocalInput(session.startsAt),
    duration: session.durationMinutes,
    notes: session.notes,
  };
}

export function sameDraft(a: SessionDraft, b: SessionDraft): boolean {
  return (
    a.title === b.title && a.start === b.start && a.duration === b.duration && a.notes === b.notes
  );
}

/**
 * Checks a draft against the server's rules before it is sent. `moved` is false when an edit leaves the start
 * alone: the server only checks the start it is sent, and a session already under way must stay editable.
 */
export function validateSession(
  draft: SessionDraft,
  now: number,
  moved = true,
): { errors: Partial<Record<SessionField, string>>; payload?: SessionPayload } {
  const errors: Partial<Record<SessionField, string>> = {};
  const title = draft.title.trim();
  if (title.length < 1) errors.title = 'Give the session a name.';
  else if (draft.title.length > SESSION_LIMITS.title)
    errors.title = `The name can be ${SESSION_LIMITS.title} characters at most.`;
  const start = parseLocalInput(draft.start);
  let startsAt = 0;
  if (!start.ok) {
    errors.start =
      start.reason === 'nonexistent'
        ? 'The clocks skip that time (daylight saving). Pick another.'
        : 'Pick a date and a time.';
  } else {
    startsAt = start.ms;
    if (moved && startsAt < now - PAST_GRACE_MS) errors.start = 'That time has already passed.';
    else if (moved && startsAt > now + TWO_YEARS_MS)
      errors.start = 'That is too far in the future (two years at most).';
  }
  const d = draft.duration;
  if (!Number.isInteger(d) || d < SESSION_LIMITS.minMinutes || d > SESSION_LIMITS.maxMinutes)
    errors.duration = 'A session runs from 15 minutes to 12 hours.';
  if (draft.notes.length > SESSION_LIMITS.notes)
    errors.notes = `The notes can be ${SESSION_LIMITS.notes} characters at most.`;
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    payload: { title, startsAt, durationMinutes: d, notes: draft.notes },
  };
}

/** Only what changed, so an edit never re-sends (and the server never re-checks) a start that was left alone. */
export function sessionPatch(
  original: SessionItem['session'],
  payload: SessionPayload,
): Partial<SessionPayload> {
  return {
    ...(payload.title !== original.title ? { title: payload.title } : {}),
    ...(payload.startsAt !== original.startsAt ? { startsAt: payload.startsAt } : {}),
    ...(payload.durationMinutes !== original.durationMinutes
      ? { durationMinutes: payload.durationMinutes }
      : {}),
    ...(payload.notes !== original.notes ? { notes: payload.notes } : {}),
  };
}

/** Only a session that has not started can be cancelled (the server enforces it too). */
export const canCancel = (startsAt: number, now: number): boolean => startsAt > now;
