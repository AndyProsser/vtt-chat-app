// The presentation both clients share: fonts, typography tokens, language fonts and icon meanings.
// Filled in task by task (docs/superpowers/plans/2026-11-24-typography-and-icons.md).
export { LANGUAGE_FONTS, STYLE_FALLBACK_CSS } from './consts/languageFonts.js';
export { languageTextStyle, styleFor } from './lib/languageTextStyle.js';
export type { LanguageFont, LanguageSwitches } from './types/languageFont.js';
export { AbilityMark, Icon, SenseIcon, VitalIcon } from './components/Icon.js';
export { ABILITY_ICON, ICON, SENSE_ICON, VITAL_ICON, type IconName } from './consts/icons.js';
export { QUIPS, pickQuip, type Quip } from './consts/quips.js';
export { useReadingPrefs } from './hooks/useReadingPrefs.js';
export {
  DEFAULT_READING_PREFS,
  applyReadingPrefs,
  applyStoredReadingPrefs,
  followReadingPrefsFromOtherWindows,
  parseReadingPrefs,
  useReadingPrefsStore,
} from './lib/readingPrefs.js';
export type { ReadingPrefs } from './types/languageFont.js';
export { useLanguageSwitches } from './hooks/useLanguageSwitches.js';
export { READING_SWITCHES } from './consts/readingSwitches.js';
