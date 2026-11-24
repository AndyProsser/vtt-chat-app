import { useShallow } from 'zustand/react/shallow';

import { useReadingPrefsStore } from '../lib/readingPrefs.js';
import type { ReadingPrefs } from '../types/languageFont.js';

/** The reading switches, live: a component using this redraws when one is flipped, in any window. */
export function useReadingPrefs(): ReadingPrefs & { set: (patch: Partial<ReadingPrefs>) => void } {
  return useReadingPrefsStore(useShallow((s) => s));
}
