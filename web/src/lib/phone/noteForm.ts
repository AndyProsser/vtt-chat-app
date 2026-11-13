import type { HandoutItem } from '../../types/phone.js';

/** What the server accepts for a note (handoutService.ts: title 1-200, text 1-20000). */
export const NOTE_LIMITS = { title: 200, body: 20_000 } as const;

export interface NoteDraft {
  title: string;
  body: string;
}

export type NoteField = 'title' | 'body';

export function validateNote(draft: NoteDraft): {
  errors: Partial<Record<NoteField, string>>;
  payload?: { title: string; text: string };
} {
  const errors: Partial<Record<NoteField, string>> = {};
  const title = draft.title.trim();
  if (title.length < 1) errors.title = 'Give the note a title.';
  else if (title.length > NOTE_LIMITS.title)
    errors.title = `The title can be ${NOTE_LIMITS.title} characters at most.`;
  if (draft.body.trim().length < 1) errors.body = 'Write something for the note.';
  else if (draft.body.length > NOTE_LIMITS.body)
    errors.body = `The note can be ${NOTE_LIMITS.body.toLocaleString('en')} characters at most.`;
  if (Object.keys(errors).length > 0) return { errors };
  return { errors, payload: { title, text: draft.body } };
}

/** "1,204 / 20,000": a counter that tells the writer how close the limit is. */
export function counter(length: number, max: number): string {
  return `${length.toLocaleString('en')} / ${max.toLocaleString('en')}`;
}

/** The counter turns to a warning in the last tenth. */
export const nearLimit = (length: number, max: number): boolean => length >= max * 0.9;

export const isShared = (h: Pick<HandoutItem, 'visibility'>): boolean =>
  h.visibility !== undefined && h.visibility !== 'dm';
