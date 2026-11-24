import type { ChatLanguageStyle } from '@vtt-chat-app/shared';

import type { LanguageFont } from '../types/languageFont.js';

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'system-ui, "Segoe UI", sans-serif';
const MONO = '"Courier New", "SF Mono", monospace';

/**
 * A font for every language, chosen by the language's `key` (docs/architecture/ICONOLOGY.md, "Language fonts").
 * The server never sees this: the wire only carries `key` and the coarse `style`. `common` has no entry on
 * purpose, it is plain body text. Sizes and tracking are a starting point, tuned by eye in the real apps.
 */
export const LANGUAGE_FONTS: Readonly<Record<string, LanguageFont>> = {
  dwarvish: { family: 'Alegreya SC', weight: 500, tracking: '.03em', fallback: SERIF },
  elvish: {
    family: 'Cormorant Garamond',
    weight: 500,
    italic: true,
    size: '1.1em',
    tracking: '.02em',
    fallback: '"Palatino Linotype","Book Antiqua",Palatino,Georgia,serif',
  },
  giant: {
    family: 'Uncial Antiqua',
    weight: 400,
    size: '.95em',
    tracking: '.03em',
    fallback: SERIF,
  },
  gnomish: { family: 'Special Elite', weight: 400, size: '.95em', fallback: MONO },
  goblin: { family: 'IM Fell English', weight: 400, size: '1.1em', fallback: SERIF },
  halfling: { family: 'Patrick Hand', weight: 400, size: '1.15em', fallback: SANS },
  orc: { family: 'Alegreya Sans SC', weight: 700, tracking: '.04em', fallback: SANS },
  draconic: {
    family: 'Pirata One',
    weight: 400,
    size: '1.12em',
    tracking: '.04em',
    fallback: SERIF,
  },
  celestial: {
    family: 'Cinzel Decorative',
    weight: 700,
    size: '.95em',
    tracking: '.06em',
    fallback: SERIF,
  },
  infernal: { family: 'IM Fell DW Pica', weight: 400, size: '1.05em', fallback: SERIF },
  abyssal: {
    family: 'Black Ops One',
    weight: 400,
    size: '.86em',
    tracking: '.03em',
    fallback: SANS,
  },
  'deep-speech': {
    family: 'Metamorphous',
    weight: 400,
    size: '.95em',
    tracking: '.03em',
    fallback: SERIF,
  },
  primordial: {
    family: 'Julius Sans One',
    weight: 400,
    size: '1.02em',
    tracking: '.06em',
    fallback: SANS,
  },
  sylvan: { family: 'Philosopher', weight: 400, size: '1.05em', fallback: SANS },
  undercommon: {
    family: 'Spirax',
    weight: 400,
    size: '1.05em',
    tracking: '.02em',
    fallback: SERIF,
  },
  druidic: { family: 'Dancing Script', weight: 600, size: '1.15em', fallback: SERIF },
  // Hidden meaning, not foreign speech: it must look like everyday text, only leaning and spaced.
  'thieves-cant': {
    family: 'Inter Variable',
    weight: 400,
    italic: true,
    tracking: '.04em',
    fallback: SANS,
  },
};

/**
 * What a language with no entry above falls back to: the coarse `style` the server sends. Only system stacks, the
 * old bundled faces are gone. Reached for a language a newer server adds before this client knows its font.
 */
export const STYLE_FALLBACK_CSS: Record<ChatLanguageStyle, Record<string, string>> = {
  plain: {},
  flowing: {
    fontFamily: '"Palatino Linotype","Book Antiqua",Palatino,Georgia,serif',
    fontStyle: 'italic',
    fontWeight: '500',
    fontSize: '1.1em',
    letterSpacing: '.02em',
  },
  blocky: {
    fontFamily: 'Rockwell,"Roboto Slab","Courier New",serif',
    fontWeight: '400',
    fontSize: '.92em',
    letterSpacing: '.03em',
  },
  angular: {
    fontFamily: '"Trebuchet MS","Segoe UI",sans-serif',
    fontWeight: '400',
    fontSize: '1.12em',
    letterSpacing: '.04em',
  },
  rounded: {
    fontFamily: 'ui-rounded,Nunito,"Varela Round",sans-serif',
    fontWeight: '500',
  },
  scratchy: {
    fontFamily: '"Brush Script MT","Segoe Script","Bradley Hand",cursive',
    fontWeight: '600',
    fontSize: '1.2em',
  },
  arcane: {
    fontFamily: 'Papyrus,Luminari,fantasy',
    fontWeight: '700',
    fontSize: '.95em',
    letterSpacing: '.06em',
  },
  mono: { fontFamily: '"Courier New","SF Mono",monospace' },
};
