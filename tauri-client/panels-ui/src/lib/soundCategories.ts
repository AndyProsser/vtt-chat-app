import type { SoundBoard } from '../types/index.js';

export type SoundCategory = 'environment' | 'background' | 'creatures';

const CREATURE = /creature|monster|animal|beast|dragon|wolf|bear|bird|dog|cat|horse|undead|demon/i;

/**
 * Sorts the DM's boards into the drawer's categories (Voice is the character voices, not sounds).
 * A looping button is Background; otherwise a board named for creatures is Creatures; everything else
 * is Environment. Derived, not stored (a board cannot yet be assigned a category by hand). Each board
 * appears under every category it has buttons in, holding only those buttons.
 */
export function categoriesOf(boards: SoundBoard[]): Record<SoundCategory, SoundBoard[]> {
  const out: Record<SoundCategory, SoundBoard[]> = {
    environment: [],
    background: [],
    creatures: [],
  };
  for (const board of boards) {
    const creatures = CREATURE.test(board.name);
    for (const category of Object.keys(out) as SoundCategory[]) {
      const buttons = board.buttons.filter((b) => {
        if (b.mode === 'loop') return category === 'background';
        return category === (creatures ? 'creatures' : 'environment');
      });
      if (buttons.length > 0) out[category].push({ ...board, buttons });
    }
  }
  return out;
}
