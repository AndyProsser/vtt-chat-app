import type { Palette, Theme, ThemeId } from '../types/theme.js';

/**
 * One table per theme, each with a dark and a light variant (light/dark follows the OS; the theme is
 * the user's choice). A new theme is one more entry — components read `--vtt-*` variables only. The
 * contrast test in `themes.test.ts` guards every entry.
 */
export const THEMES: readonly Theme[] = [
  {
    id: 'dragonfire',
    name: 'Dragonfire',
    dark: {
      bg: '#1a1412',
      bar: '#241a16',
      rail: '#1e1613',
      chat: '#171110',
      bubble: '#2a1f1a',
      edge: '#4a3326',
      ink: '#eadfd2',
      gold: '#d9a441',
      glow: '#ff7a2f',
      avatar: '#6b2a1c',
      whisper: '#2c2038',
      whisperEdge: '#7b4fd1',
      dmMsg: '#33261a',
    },
    light: {
      bg: '#efe3c8',
      bar: '#e2d0a8',
      rail: '#e8d9b5',
      chat: '#f4ead2',
      bubble: '#fbf4e2',
      edge: '#a98a54',
      ink: '#3a2a18',
      gold: '#8a5a12',
      glow: '#c8501a',
      avatar: '#8a3b22',
      whisper: '#efe0f5',
      whisperEdge: '#7b4fd1',
      dmMsg: '#fbe7bd',
    },
  },
  {
    id: 'arcane',
    name: 'Arcane night',
    dark: {
      bg: '#0f1226',
      bar: '#161a38',
      rail: '#12163a',
      chat: '#0c0f22',
      bubble: '#1b2047',
      edge: '#3b3f8c',
      ink: '#e6e8ff',
      gold: '#e5c76b',
      glow: '#7ee0ff',
      avatar: '#3a2f8f',
      whisper: '#2a1850',
      whisperEdge: '#b07cff',
      dmMsg: '#2b2748',
    },
    light: {
      bg: '#eef0ff',
      bar: '#dcdffa',
      rail: '#e5e7fb',
      chat: '#f5f6ff',
      bubble: '#ffffff',
      edge: '#8a90d6',
      ink: '#1c2050',
      gold: '#7a5a00',
      glow: '#1f7fa8',
      avatar: '#4b3fb0',
      whisper: '#efe4ff',
      whisperEdge: '#7b4fd1',
      dmMsg: '#fff3d0',
    },
  },
  {
    id: 'dungeon',
    name: 'Dungeon stone',
    dark: {
      bg: '#1b1d1c',
      bar: '#262a28',
      rail: '#202322',
      chat: '#181a19',
      bubble: '#2b302d',
      edge: '#505850',
      ink: '#e3e6df',
      gold: '#c9b26b',
      glow: '#8bd36b',
      avatar: '#46503f',
      whisper: '#2c2f3d',
      whisperEdge: '#6f86d6',
      dmMsg: '#33322a',
    },
    light: {
      bg: '#e6e8e1',
      bar: '#d5d9cf',
      rail: '#dde0d6',
      chat: '#eef0e9',
      bubble: '#f8f9f5',
      edge: '#8a9284',
      ink: '#232822',
      gold: '#6b5a14',
      glow: '#3d8a2b',
      avatar: '#5a6a4e',
      whisper: '#e4e8f7',
      whisperEdge: '#4a62b8',
      dmMsg: '#f3efd6',
    },
  },
  {
    id: 'verdant',
    name: 'Verdant',
    dark: {
      bg: '#101a14',
      bar: '#17251c',
      rail: '#131f17',
      chat: '#0d1510',
      bubble: '#1d2f23',
      edge: '#34553e',
      ink: '#e2efe4',
      gold: '#d4b24a',
      glow: '#7be08a',
      avatar: '#2f6b43',
      whisper: '#2a2236',
      whisperEdge: '#a78bfa',
      dmMsg: '#2e2c1a',
    },
    light: {
      bg: '#e6f0e3',
      bar: '#d3e5ce',
      rail: '#dcead8',
      chat: '#eff6ec',
      bubble: '#fafdf8',
      edge: '#7ea080',
      ink: '#17301f',
      gold: '#6e5a10',
      glow: '#1f8a3a',
      avatar: '#3f7f55',
      whisper: '#ece6f7',
      whisperEdge: '#6d4fc2',
      dmMsg: '#f6efcf',
    },
  },
  {
    id: 'frostbound',
    name: 'Frostbound',
    dark: {
      bg: '#0f1720',
      bar: '#16212d',
      rail: '#121b25',
      chat: '#0c131a',
      bubble: '#1b2a3a',
      edge: '#3a5570',
      ink: '#e4eef7',
      gold: '#b9d4e8',
      glow: '#7fd4ff',
      avatar: '#2d5b80',
      whisper: '#271f3a',
      whisperEdge: '#a58cf0',
      dmMsg: '#2a3340',
    },
    light: {
      bg: '#e8f0f7',
      bar: '#d3e2ee',
      rail: '#dce8f2',
      chat: '#f1f6fa',
      bubble: '#fbfdff',
      edge: '#8aa6bd',
      ink: '#14283a',
      gold: '#3b5f7d',
      glow: '#0e7fb3',
      avatar: '#3c6e96',
      whisper: '#ece6f8',
      whisperEdge: '#6d4fc2',
      dmMsg: '#e3ecf4',
    },
  },
];

export const DEFAULT_THEME: ThemeId = 'dragonfire';

/** A stored or typed theme id → a real one; anything unknown becomes the default. */
export function resolveTheme(id: string | null | undefined): ThemeId {
  return THEMES.find((t) => t.id === id)?.id ?? DEFAULT_THEME;
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function declarations(p: Palette): string {
  return Object.entries(p)
    .map(([k, v]) => `--vtt-${kebab(k)}:${v};`)
    .join('');
}

/** CSS for every theme: light under `:root[data-theme]`, dark inside a `prefers-color-scheme: dark` block. */
export function themeCss(themes: readonly Theme[] = THEMES): string {
  return themes
    .map(
      (t) =>
        `:root[data-theme="${t.id}"]{${declarations(t.light)}color-scheme:light}` +
        `@media (prefers-color-scheme: dark){:root[data-theme="${t.id}"]{${declarations(t.dark)}color-scheme:dark}}`,
    )
    .join('\n');
}
