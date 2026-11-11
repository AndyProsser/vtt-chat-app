import type { ParsedComposerInput } from '@vtt-chat-app/shared';

import type { RsvpStatus, SessionView } from '../types/index.js';

/** What the composer does for one typed line; each part is optional and runs in this order. */
export interface SendPlan {
  /** A public line; `kind` and `lang` are left out for a plain `chat` line. */
  chat?: { text: string; kind?: 'say' | 'do' | 'ooc'; lang?: string };
  whisper?: { to: string; text: string };
  /** Set the user's RSVP for the next upcoming session (the caller finds it; none means skip). */
  rsvp?: RsvpStatus;
}

/** Maps a shared parse result onto sends. `error` has no plan: nothing is sent. */
export function planSend(parsed: ParsedComposerInput): SendPlan | undefined {
  switch (parsed.type) {
    case 'error':
      return undefined;
    case 'whisper':
      return { whisper: { to: parsed.recipientId, text: parsed.text } };
    case 'quick':
      return {
        chat: { text: parsed.text, kind: 'ooc' },
        ...(parsed.rsvp ? { rsvp: parsed.rsvp === 'no' ? 'no' : 'late' } : {}),
      };
    case 'send':
      return {
        chat: {
          text: parsed.text,
          ...(parsed.kind !== 'chat' ? { kind: parsed.kind } : {}),
          ...(parsed.lang ? { lang: parsed.lang } : {}),
        },
      };
  }
}

/**
 * The next scheduled session: the soonest one that has not been cancelled and has not started.
 * (One already under way is not "next"; the server's attendance window still lets people change that
 * one from the sessions card.)
 */
export function nextUpcoming(
  sessions: readonly SessionView[],
  now: number,
): SessionView | undefined {
  return sessions
    .filter((s) => s.session.cancelledAt === null && s.session.startsAt > now)
    .sort((a, b) => a.session.startsAt - b.session.startsAt)[0];
}
