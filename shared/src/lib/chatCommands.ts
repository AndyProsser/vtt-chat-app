import { BASE_CHAT_COMMANDS, CHAT_KINDS, CHAT_LANGUAGES } from '../consts/chat.js';
import type { ChatCommand, ChatKind, ChatLanguage } from '../types/chat.js';

/** Lower-cases and folds spaces, underscores and apostrophes, so "Deep_Speech" and "thieves'cant" both resolve. */
const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[\s_]+/g, '-');

export const isChatKind = (value: unknown): value is ChatKind =>
  typeof value === 'string' && (CHAT_KINDS as readonly string[]).includes(value);

/** True only for a canonical wire key, which is what the server accepts. */
export const isChatLanguageKey = (value: unknown): boolean =>
  typeof value === 'string' && CHAT_LANGUAGES.some((l) => l.key === value);

/** Resolves what someone typed after `/say-` (a key, a name or an alias) to a language. */
export const findChatLanguage = (input: string): ChatLanguage | undefined => {
  const wanted = fold(input);
  if (wanted === '') return undefined;
  return CHAT_LANGUAGES.find(
    (l) => l.key === wanted || fold(l.name) === wanted || l.aliases.some((a) => fold(a) === wanted),
  );
};

/** The `say-<language>` commands, generated from the language table. */
export const sayLanguageCommands = (): ChatCommand[] =>
  CHAT_LANGUAGES.map((l) => ({
    name: `say-${l.key}`,
    aliases: l.aliases.map((a) => `say-${a}`),
    usage: `/say-${l.key} <text>`,
    description: `Speak ${l.name}`,
    kind: 'say' as const,
  }));

/** Every command, including the generated `say-<language>` ones. */
export const chatCommands = (): ChatCommand[] => [...BASE_CHAT_COMMANDS, ...sayLanguageCommands()];

/** Finds a fixed command by its name or alias (case-insensitive, no slash). `say-<language>` is not here. */
export const findBaseCommand = (name: string): ChatCommand | undefined => {
  const n = name.toLowerCase();
  return BASE_CHAT_COMMANDS.find((c) => c.name === n || c.aliases.includes(n));
};
