import type { Member } from '../types/index.js';

/** Rows a player list shows before it scrolls. */
export const PICKER_ROWS = 6;

/** What a player is called in a picker: the character's name, with the person's own name beneath it. */
export function playerLines(m: Member): { primary: string; secondary?: string } {
  const character = m.character?.name;
  return character ? { primary: character, secondary: m.displayName } : { primary: m.displayName };
}
