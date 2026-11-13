import {
  CHAT_LANGUAGES,
  LANGUAGE_STYLE_CSS,
  type ChatKind,
  type ChatLanguageStyle,
} from '@vtt-chat-app/shared';
import type { CSSProperties } from 'react';

/** The same table as the web app (it lives in `shared/`); the font files load only when a line first uses them. */
export const LANGUAGE_STYLES = LANGUAGE_STYLE_CSS as Record<ChatLanguageStyle, CSSProperties>;

/** A line's kind; a missing or unknown one (an older server) is plain `chat`. */
export const kindOf = (raw: unknown): ChatKind =>
  raw === 'say' || raw === 'do' || raw === 'ooc' ? raw : 'chat';

/** The language of a `say` line, or `undefined` for none or one this build does not know. */
export const languageOf = (key: string | undefined) =>
  key === undefined ? undefined : CHAT_LANGUAGES.find((l) => l.key === key);

/** The inline style for the text of a line spoken in `key`; nothing for an unknown or plain language. */
export const languageStyle = (key: string | undefined): CSSProperties | undefined => {
  const lang = languageOf(key);
  return lang ? LANGUAGE_STYLES[lang.style] : undefined;
};
