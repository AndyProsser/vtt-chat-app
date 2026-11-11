import { CHAT_LANGUAGES, type ChatKind, type ChatLanguageStyle } from '@vtt-chat-app/shared';
import type { CSSProperties } from 'react';

/** System fonts only (no font files); the same table as the web app. */
export const LANGUAGE_STYLES: Record<ChatLanguageStyle, CSSProperties> = {
  plain: {},
  flowing: {
    fontFamily: '"Palatino Linotype","Book Antiqua",Palatino,Georgia,serif',
    fontStyle: 'italic',
    letterSpacing: '.02em',
  },
  blocky: {
    fontFamily: 'Rockwell,"Roboto Slab","Courier New",serif',
    fontWeight: 'bold',
    letterSpacing: '.04em',
  },
  angular: {
    fontFamily: '"Trebuchet MS","Segoe UI",sans-serif',
    fontStyle: 'italic',
    fontVariantCaps: 'small-caps',
    letterSpacing: '.08em',
  },
  rounded: { fontFamily: 'ui-rounded,Nunito,"Varela Round",sans-serif' },
  scratchy: { fontFamily: '"Brush Script MT","Segoe Script","Bradley Hand",cursive' },
  arcane: {
    fontFamily: 'Papyrus,Luminari,fantasy',
    fontVariantCaps: 'small-caps',
    letterSpacing: '.12em',
  },
  mono: { fontFamily: '"Courier New","SF Mono",monospace' },
};

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
