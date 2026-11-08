export type ThemeId = 'dragonfire' | 'arcane' | 'dungeon' | 'verdant' | 'frostbound';

/** Every colour a theme decides; all `#rrggbb`. Shape (radii, spacing, fonts) is shared by themes. */
export interface Palette {
  bg: string;
  bar: string;
  rail: string;
  chat: string;
  bubble: string;
  edge: string;
  ink: string;
  gold: string;
  glow: string;
  avatar: string;
  whisper: string;
  whisperEdge: string;
  dmMsg: string;
}

export interface Theme {
  id: ThemeId;
  name: string;
  dark: Palette;
  light: Palette;
}
