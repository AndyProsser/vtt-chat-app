import { useMemo } from 'react';

import { useReadingPrefsStore } from '../lib/readingPrefs.js';
import type { LanguageSwitches } from '../types/languageFont.js';

/**
 * The two switches that change how a language line is drawn, for `languageTextStyle`. Subscribes to just these two
 * values, so a line redraws when one is flipped and not when anything else about the store changes.
 */
export function useLanguageSwitches(): LanguageSwitches {
  const languageFonts = useReadingPrefsStore((s) => s.languageFonts);
  const forceReadable = useReadingPrefsStore((s) => s.forceReadable);
  return useMemo(() => ({ languageFonts, forceReadable }), [languageFonts, forceReadable]);
}
