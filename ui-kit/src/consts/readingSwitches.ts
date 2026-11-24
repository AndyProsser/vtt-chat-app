import type { ReadingPrefs } from '../types/languageFont.js';

/** The three reading switches as the settings screens list them, the same words in both apps. */
export const READING_SWITCHES: ReadonlyArray<{
  key: keyof ReadingPrefs;
  label: string;
  hint: string;
}> = [
  {
    key: 'languageFonts',
    label: 'Language-specific fonts',
    hint: 'Each in-world language in its own typeface. Off: every language reads in the normal font.',
  },
  {
    key: 'documentFonts',
    label: 'Decorative document fonts',
    hint: 'Handouts and quoted speech in a bookish typeface. Off: the normal font.',
  },
  {
    key: 'forceReadable',
    label: 'Force readable mode',
    hint: 'Everything in the normal font, whatever the two above say. The language name stays on each line.',
  },
];
