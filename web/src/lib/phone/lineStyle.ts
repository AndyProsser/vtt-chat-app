import { CHAT_LANGUAGES, type ChatKind } from '@vtt-chat-app/shared';
import { languageTextStyle, type LanguageSwitches } from '@vtt-chat-app/ui-kit';
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

const language = (key: string | undefined) => CHAT_LANGUAGES.find((l) => l.key === key);

/** The inline style for a say line's language (the same table as the desktop app, from ui-kit); none for no or an unknown language. */
export const languageStyle = (
  key: string | undefined,
  switches?: LanguageSwitches,
): CSSProperties | undefined => languageTextStyle(key, switches);

/** "in Elvish": the caption under a language line (real text, so assistive tech reads it). */
export const languageCaption = (key: string | undefined): string | undefined => {
  const l = language(key);
  return l ? `in ${l.name}` : undefined;
};

/** What a line shows as its text: a `do` line reads as a stage direction, a `say` line is quoted. */
export function lineText(line: Pick<ChatLine, 'kind' | 'text' | 'fromName'>): string {
  if (line.kind === 'do') return `${line.fromName} ${line.text}`; // the bubble draws the action icon before it
  if (line.kind === 'say') return `“${line.text}”`;
  return line.text;
}
