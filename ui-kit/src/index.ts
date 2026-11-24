// The presentation both clients share: fonts, typography tokens, language fonts and icon meanings.
// Filled in task by task (docs/superpowers/plans/2026-11-24-typography-and-icons.md).
export { LANGUAGE_FONTS, STYLE_FALLBACK_CSS } from './consts/languageFonts.js';
export { languageTextStyle, styleFor } from './lib/languageTextStyle.js';
export type { LanguageFont, LanguageSwitches } from './types/languageFont.js';
export { Icon, SenseIcon, VitalIcon } from './components/Icon.js';
export { ICON, SENSE_ICON, VITAL_ICON, type IconName } from './consts/icons.js';
