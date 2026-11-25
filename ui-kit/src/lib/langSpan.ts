import { CHAT_LANGUAGES } from '@vtt-chat-app/shared';
import { defaultUrlTransform } from 'react-markdown';

/** A language's real key from any name chat accepts for it (`dwarven`, `Elf`, `thievescant`); nothing for common or an unknown one. */
function languageKey(name: string): string | undefined {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  const lang = CHAT_LANGUAGES.find((l) => l.key === wanted || l.aliases.includes(wanted));
  return lang && lang.key !== 'common' ? lang.key : undefined;
}

/**
 * The language of a `[words](lang:dwarvish)` link, or nothing for any other link (see docs/architecture/
 * RPG-MARKDOWN-EXTENSION.md). Anything but a known, non-common language is left as the plain link it is.
 */
export function parseLangHref(href: string | undefined): string | undefined {
  const match = href ? /^lang:(.+)$/i.exec(href.trim()) : null;
  return match ? languageKey(match[1]!) : undefined;
}

/** react-markdown blanks addresses it does not know; a `lang:` one is not an address, so it passes. Everything else is as before. */
export const langUrlTransform = (url: string): string =>
  /^lang:/i.test(url) ? url : defaultUrlTransform(url);

/** The language of a fenced block whose info string names one (a `language-dwarvish` class); nothing for ordinary code. */
export function langFromFence(className: string | undefined): string | undefined {
  const match = className ? /(?:^|\s)language-([\w-]+)/.exec(className) : null;
  return match ? languageKey(match[1]!) : undefined;
}
