import type { ChatCommand, ChatKind, ChatLanguage, ChatLanguageStyle } from '../types/chat.js';

export const CHAT_KINDS: readonly ChatKind[] = ['chat', 'say', 'do', 'ooc'];

/** The D&D 5e languages. `lang` on the wire is one of these keys; the server rejects anything else. */
export const CHAT_LANGUAGES: readonly ChatLanguage[] = [
  { key: 'common', name: 'Common', style: 'plain', aliases: [] },
  { key: 'dwarvish', name: 'Dwarvish', style: 'blocky', aliases: ['dwarven', 'dwarf'] },
  { key: 'elvish', name: 'Elvish', style: 'flowing', aliases: ['elven', 'elf'] },
  { key: 'giant', name: 'Giant', style: 'blocky', aliases: [] },
  { key: 'gnomish', name: 'Gnomish', style: 'rounded', aliases: ['gnome'] },
  { key: 'goblin', name: 'Goblin', style: 'scratchy', aliases: ['goblinoid'] },
  { key: 'halfling', name: 'Halfling', style: 'rounded', aliases: [] },
  { key: 'orc', name: 'Orc', style: 'angular', aliases: ['orcish'] },
  { key: 'abyssal', name: 'Abyssal', style: 'angular', aliases: [] },
  { key: 'celestial', name: 'Celestial', style: 'flowing', aliases: [] },
  { key: 'draconic', name: 'Draconic', style: 'arcane', aliases: ['dragon'] },
  { key: 'deep-speech', name: 'Deep Speech', style: 'arcane', aliases: ['deepspeech'] },
  { key: 'infernal', name: 'Infernal', style: 'angular', aliases: [] },
  { key: 'primordial', name: 'Primordial', style: 'arcane', aliases: [] },
  { key: 'sylvan', name: 'Sylvan', style: 'flowing', aliases: [] },
  { key: 'undercommon', name: 'Undercommon', style: 'scratchy', aliases: [] },
  {
    key: 'thieves-cant',
    name: "Thieves' cant",
    style: 'mono',
    aliases: ['thieves', 'thievescant'],
  },
  { key: 'druidic', name: 'Druidic', style: 'flowing', aliases: ['druid'] },
];

/** The fixed commands. `say-<language>` commands are generated from the language table (see `chatCommands`). */
export const BASE_CHAT_COMMANDS: readonly ChatCommand[] = [
  {
    name: 'say',
    aliases: [],
    usage: '/say <text>',
    description: 'The character speaks, in quotation marks',
    kind: 'say',
  },
  {
    name: 'do',
    aliases: ['me'],
    usage: '/do <text>',
    description: 'An action: Thorin raises his axe',
    kind: 'do',
  },
  {
    name: 'ooc',
    aliases: [],
    usage: '/ooc <text>',
    description: 'Out of character; never recorded',
    kind: 'ooc',
  },
  {
    name: 'tell',
    aliases: ['w'],
    usage: '/tell <name> <text>',
    description: 'Whisper to one person at the table',
    kind: 'whisper',
  },
  {
    name: 'dm',
    aliases: [],
    usage: '/dm <text>',
    description: 'Whisper to the DM',
    kind: 'whisper',
  },
  {
    name: 'late',
    aliases: [],
    usage: '/late [note]',
    description: 'Running late (also RSVPs "late")',
    kind: 'ooc',
  },
  {
    name: 'cant',
    aliases: [],
    usage: '/cant [note]',
    description: 'Can\'t make it (also RSVPs "no")',
    kind: 'ooc',
  },
  {
    name: 'work',
    aliases: [],
    usage: '/work',
    description: 'Still at work (also RSVPs "late")',
    kind: 'ooc',
  },
  {
    name: 'brb',
    aliases: [],
    usage: '/brb [note]',
    description: 'Be right back',
    kind: 'ooc',
  },
  {
    name: 'afk',
    aliases: [],
    usage: '/afk [note]',
    description: 'Away from the keyboard',
    kind: 'ooc',
  },
  {
    name: 'back',
    aliases: [],
    usage: '/back',
    description: 'Back at the keyboard',
    kind: 'ooc',
  },
];

/**
 * How each language style is set (CSS properties in camelCase), shared by the web app and the desktop app so a line
 * looks the same in both. The first family in each stack is a web font that is bundled with each client and fetched
 * only when a line in a language that uses it is first shown (browsers load an `@font-face` file lazily); the rest is
 * the system fallback. Sizes are nudged because these faces have very different x-heights. The weights match the font
 * files each client imports (see `languageFonts.ts`): Cormorant Garamond italic 500, Alfa Slab One 400, Pirata One 400,
 * Fredoka 500, Caveat 600, Cinzel Decorative 700, Share Tech Mono 400.
 */
export const LANGUAGE_STYLE_CSS: Record<ChatLanguageStyle, Record<string, string>> = {
  plain: {},
  flowing: {
    fontFamily: '"Cormorant Garamond","Palatino Linotype","Book Antiqua",Palatino,Georgia,serif',
    fontStyle: 'italic',
    fontWeight: '500',
    fontSize: '1.1em',
    letterSpacing: '.02em',
  },
  blocky: {
    fontFamily: '"Alfa Slab One",Rockwell,"Roboto Slab","Courier New",serif',
    fontWeight: '400',
    fontSize: '.92em',
    letterSpacing: '.03em',
  },
  angular: {
    fontFamily: '"Pirata One","Trebuchet MS","Segoe UI",sans-serif',
    fontWeight: '400',
    fontSize: '1.12em',
    letterSpacing: '.04em',
  },
  rounded: {
    fontFamily: 'Fredoka,ui-rounded,Nunito,"Varela Round",sans-serif',
    fontWeight: '500',
  },
  scratchy: {
    fontFamily: 'Caveat,"Brush Script MT","Segoe Script","Bradley Hand",cursive',
    fontWeight: '600',
    fontSize: '1.2em',
  },
  arcane: {
    fontFamily: '"Cinzel Decorative",Papyrus,Luminari,fantasy',
    fontWeight: '700',
    fontSize: '.95em',
    letterSpacing: '.06em',
  },
  mono: { fontFamily: '"Share Tech Mono","Courier New","SF Mono",monospace' },
};
