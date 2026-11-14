import {
  composerKeyAction,
  type ChatContext,
  type ComposerKey,
  type ChatRsvp,
  type ChatSuggestion,
  type ChatSuggestions,
  type ParsedComposerInput,
} from '@vtt-chat-app/shared';

import type { Member, SessionItem } from '../../types/phone.js';
import type { SayOptions } from './socket.js';

/** What to do for a parsed line: the chat frame to send and, for a quick command, an RSVP to set. */
export interface SendPlan {
  text: string;
  say: SayOptions;
  rsvp?: ChatRsvp;
}

/** Maps a parse result to the frame (and RSVP) it means; errors have no plan. */
export function planSend(parsed: ParsedComposerInput): SendPlan | undefined {
  switch (parsed.type) {
    case 'send':
      return {
        text: parsed.text,
        say: { kind: parsed.kind, ...(parsed.lang === undefined ? {} : { lang: parsed.lang }) },
      };
    case 'whisper':
      return { text: parsed.text, say: { to: parsed.recipientId } };
    case 'quick':
      return {
        text: parsed.text,
        say: { kind: parsed.kind },
        ...(parsed.rsvp === undefined ? {} : { rsvp: parsed.rsvp }),
      };
    case 'error':
      return undefined;
  }
}

/** The next session that has not ended and is not cancelled: the one a quick command's RSVP applies to. */
export function nextUpcomingSession(
  items: readonly SessionItem[],
  now: number,
): SessionItem | undefined {
  return items
    .filter(
      (i) =>
        i.session.cancelledAt === null &&
        i.session.startsAt + i.session.durationMinutes * 60_000 > now,
    )
    .sort((a, b) => a.session.startsAt - b.session.startsAt)[0];
}

/** The composer's view of the table: everyone, you included (the parser needs you for /dm and quick lines). */
export const chatContext = (selfId: string, members: readonly Member[]): ChatContext => ({
  selfId,
  members: members.map((m) => ({
    id: m.userId,
    name: m.displayName,
    characterName: m.character?.name ?? null,
    role: m.role,
  })),
});

/**
 * The suggestions worth showing. A command that is already typed out in full (`/late`, no space yet) is hidden,
 * so Enter does not stop to "complete" something already complete.
 */
export function visibleSuggestions(s: ChatSuggestions, text: string): ChatSuggestion[] {
  if (s.kind === 'commands' || s.kind === 'languages') {
    return s.items.length === 1 && s.items[0]?.insert.trimEnd() === text ? [] : s.items;
  }
  return s.items;
}

/** The warning for a likely mistyped command; sending the same text again posts it as plain text. */
export const TYPO_WARNING = 'No such command — press send again to post it as text';

/** Chat lines the server rejected for a bad kind or language. */
export const ERROR_FRAME_MESSAGES: Record<string, string> = {
  invalid_kind: 'The server did not accept that kind of message.',
  invalid_lang: 'The server did not accept that language.',
};

export type KeyLike = ComposerKey;

/**
 * Whether this key sends the message: a bare Enter with a mouse and keyboard (Ctrl or Cmd+Enter is a new line, see
 * `composerKeyAction` in shared/, and Shift+Enter too). On a touch device Enter is a new line and the Send button sends.
 */
export function sendsOnKey(e: KeyLike, coarsePointer: boolean): boolean {
  return composerKeyAction(e, coarsePointer) === 'send';
}

/** Widths at or below this (CSS px) get the short placeholder: the long one wraps to two lines on a phone. */
export const NARROW_COMPOSER_PX = 480;

/** The composer's placeholder: the full hint where it fits, a short one on a narrow screen. */
export const composerPlaceholder = (narrow: boolean): string =>
  narrow ? 'Message the table…' : 'Message the table, or type / for commands';
