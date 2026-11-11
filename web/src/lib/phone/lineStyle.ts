import { CHAT_LANGUAGES, type ChatKind, type ChatLanguageStyle } from '@vtt-chat-app/shared';
import type { CSSProperties } from 'react';

import type { ChatLine } from '../../types/phone.js';

/** The line's kind (a whisper is always styled as itself, never by kind). */
export const lineKind = (line: Pick<ChatLine, 'kind' | 'toId'>): ChatKind | 'whisper' =>
  line.toId !== null ? 'whisper' : (line.kind ?? 'chat');

export const KIND_CLASS: Record<ChatKind | 'whisper', string> = {
  chat: 'phone-line-chat',
  say: 'phone-line-say',
  do: 'phone-line-do',
  ooc: 'phone-line-ooc',
  whisper: 'phone-line-whisper',
};

/** System fonts only, no font files. The same table is used by the desktop app so the two match. */
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

const language = (key: string | undefined) => CHAT_LANGUAGES.find((l) => l.key === key);

/** The inline style for a say line's language; none for no or an unknown language. */
export const languageStyle = (key: string | undefined): CSSProperties | undefined => {
  const l = language(key);
  return l ? LANGUAGE_STYLES[l.style] : undefined;
};

/** "in Elvish": the caption under a language line (real text, so assistive tech reads it). */
export const languageCaption = (key: string | undefined): string | undefined => {
  const l = language(key);
  return l ? `in ${l.name}` : undefined;
};

/** What a line shows as its text: a `do` line reads as a stage direction, a `say` line is quoted. */
export function lineText(line: Pick<ChatLine, 'kind' | 'text' | 'fromName'>): string {
  if (line.kind === 'do') return `* ${line.fromName} ${line.text}`;
  if (line.kind === 'say') return `“${line.text}”`;
  return line.text;
}
