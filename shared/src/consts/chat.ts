import type { ChatCommand, ChatKind, ChatLanguage } from '../types/chat.js';

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
