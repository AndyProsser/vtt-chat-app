import { CHAT_LANGUAGES, type ChatLanguage } from '@vtt-chat-app/shared';
import type { CSSProperties } from 'react';

import { LANGUAGE_FONTS, STYLE_FALLBACK_CSS } from '../consts/languageFonts.js';
import type { LanguageFont, LanguageSwitches } from '../types/languageFont.js';

const DEFAULT_SWITCHES: LanguageSwitches = { languageFonts: true, forceReadable: false };

const fromFont = (f: LanguageFont): CSSProperties => ({
  fontFamily: `"${f.family}", ${f.fallback}`,
  fontWeight: String(f.weight),
  ...(f.italic ? { fontStyle: 'italic' } : {}),
  ...(f.size ? { fontSize: f.size } : {}),
  ...(f.tracking ? { letterSpacing: f.tracking } : {}),
});

/** The style for one language: its own font when this client has one, else the wire `style`'s system fallback. */
export function styleFor(
  lang: ChatLanguage,
  fonts: Readonly<Record<string, LanguageFont>> = LANGUAGE_FONTS,
): CSSProperties {
  if (lang.key === 'common') return {};
  const font = fonts[lang.key];
  if (font) return fromFont(font);
  return (STYLE_FALLBACK_CSS[lang.style] ?? {}) as CSSProperties;
}

/**
 * The inline style for text spoken in the language `key`: `undefined` for none or one this build does not know,
 * `{}` for plain text (common, or the reader switched language fonts off or chose force readable).
 */
export function languageTextStyle(
  key: string | undefined,
  switches: LanguageSwitches = DEFAULT_SWITCHES,
): CSSProperties | undefined {
  const lang = key === undefined ? undefined : CHAT_LANGUAGES.find((l) => l.key === key);
  if (!lang) return undefined;
  if (!switches.languageFonts || switches.forceReadable) return {};
  return styleFor(lang);
}
