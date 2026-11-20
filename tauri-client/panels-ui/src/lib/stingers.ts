import type { SoundBoard } from '../types/index.js';

/** The most stingers (and, separately, scenes) the deck holds: at most 8 each (Andy, 2026-11-20). */
export const MAX_PINS = 8;
const DEFAULT_PINS = 8;
const RESULTS = 8;

export interface FlatSound {
  soundId: string;
  label: string;
  board: string;
  volume: number;
}

/** Every one-shot sound the DM has, once each (a sound on two boards counts once). Loops are for scenes. */
export function flattenSounds(boards: SoundBoard[]): FlatSound[] {
  const seen = new Set<string>();
  const out: FlatSound[] = [];
  for (const board of boards) {
    for (const b of board.buttons) {
      if (b.mode === 'loop' || seen.has(b.soundId)) continue;
      seen.add(b.soundId);
      out.push({ soundId: b.soundId, label: b.label, board: board.name, volume: b.volume });
    }
  }
  return out;
}

/** Sounds whose name or board contains the text; with no text, the first few. */
export function searchSounds(sounds: FlatSound[], query: string): FlatSound[] {
  const q = query.trim().toLowerCase();
  const hits = q ? sounds.filter((s) => `${s.label} ${s.board}`.toLowerCase().includes(q)) : sounds;
  return hits.slice(0, q ? 50 : RESULTS);
}

/** Pins `soundId`, or unpins it if pinned; a full deck stays as it is. */
export function togglePin(pins: string[], soundId: string): string[] {
  if (pins.includes(soundId)) return pins.filter((p) => p !== soundId);
  return pins.length >= MAX_PINS ? pins : [...pins, soundId];
}

/** What is pinned before the DM chooses: the first sounds in the library's order, which starts with the board of background unease (chains, footsteps, creaks, bats...). */
export function defaultPins(sounds: FlatSound[]): string[] {
  return sounds.slice(0, DEFAULT_PINS).map((s) => s.soundId);
}

/** Whether the deck already holds the most it may. */
export const deckFull = (pins: readonly string[]): boolean => pins.length >= MAX_PINS;
