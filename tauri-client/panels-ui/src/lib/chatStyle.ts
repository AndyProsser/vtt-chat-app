import { CHAT_LANGUAGES, type ChatKind } from '@vtt-chat-app/shared';
import { languageTextStyle } from '@vtt-chat-app/ui-kit';
import type { CSSProperties } from 'react';

/** A line's kind; a missing or unknown one (an older server) is plain `chat`. */
export const kindOf = (raw: unknown): ChatKind =>
  raw === 'say' || raw === 'do' || raw === 'ooc' ? raw : 'chat';

/** The language of a `say` line, or `undefined` for none or one this build does not know. */
export const languageOf = (key: string | undefined) =>
  key === undefined ? undefined : CHAT_LANGUAGES.find((l) => l.key === key);

/** The inline style for the text of a line spoken in `key` (the same table as the web app, from ui-kit); nothing for an unknown or plain language. */
export const languageStyle = (key: string | undefined): CSSProperties | undefined =>
  languageTextStyle(key);
