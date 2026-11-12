import type {
  ChatContext,
  ChatRsvp,
  ChatSuggestion,
  ChatSuggestions,
  ParsedComposerInput,
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

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

/**
 * Whether a key press sends the line. Ctrl/Cmd+Enter always does. A bare Enter does on a device with a real
 * keyboard and pointer (like every desktop chat; Shift+Enter makes a new line) but not on a touch device,
 * where Enter is how you start a new line and the Send button sends.
 */
export function sendsOnKey(e: KeyLike, coarsePointer: boolean): boolean {
  if (e.key !== 'Enter' || e.isComposing) return false;
  if (e.ctrlKey || e.metaKey) return true;
  return !coarsePointer && !e.shiftKey;
}
