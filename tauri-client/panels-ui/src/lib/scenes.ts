import type { SoundScene } from '../types/index.js';

const DEFAULT_SHOWN = 6;

/** Scenes whose name contains the text (all of them with no text), at most 50. */
export function searchScenes(scenes: SoundScene[], query: string): SoundScene[] {
  const q = query.trim().toLowerCase();
  const hits = q ? scenes.filter((s) => s.name.toLowerCase().includes(q)) : scenes;
  return hits.slice(0, 50);
}

/** What is shown on the deck before the DM chooses: the first few scenes. */
export function defaultShownScenes(scenes: SoundScene[]): string[] {
  return scenes.slice(0, DEFAULT_SHOWN).map((s) => s.id);
}
