import { soundNameOf } from '@vtt-chat-app/shared';

import type { SoundBoard, SoundButton, SoundRecord } from '../types/index.js';

/** A button as the server takes it: a new one has no id yet. */
type NewButton = Omit<SoundButton, 'id'> & { id?: string };

/** The board every uploaded effect is added to, so it appears among the Stingers without any board editing. */
export const MY_BOARD_NAME = 'My sounds';
/** The server's limit on a board's buttons; the board stops growing there. */
const MAX_BOARD_BUTTONS = 60;
/** The server's limit on one clip (5 MB); the app checks first so a big file fails at once. */
export const MAX_CLIP_BYTES = 5 * 1024 * 1024;

export type ClipCategory = 'effect' | 'ambience' | 'music';
export const CATEGORY_LABEL: Record<ClipCategory, string> = {
  effect: 'Effect',
  ambience: 'Ambience',
  music: 'Music',
};

/** A name for a clip from its file name: `door_slam_02.ogg` becomes `Door slam`. */
export const nameFromFile = (filename: string): string => soundNameOf(filename) || 'New sound';

/** The DM's own sounds (not the catalogue that ships with the server), by name. */
export const ownSounds = (sounds: SoundRecord[]): SoundRecord[] =>
  sounds.filter((s) => !s.shared).sort((a, b) => a.name.localeCompare(b.name));

/** Why a file cannot be a clip, or undefined when it can (the server still checks the bytes). */
export function clipProblem(file: { name: string; size: number }): string | undefined {
  if (!/\.(ogg|wav|mp3|flac)$/i.test(file.name)) return 'Choose an OGG, WAV, MP3 or FLAC file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_CLIP_BYTES) return 'That clip is over 5 MB. Trim it or use a shorter one.';
  return undefined;
}

/**
 * The body that saves "My sounds" with `sound` added as a one-shot button: the board you already have, or a new
 * one. Undefined when the board is full or the sound is already on it.
 */
export function boardWithSound(
  boards: SoundBoard[],
  sound: { id: string; name: string },
): { id: string | undefined; body: { name: string; buttons: NewButton[] } } | undefined {
  const mine = boards.find((b) => !b.shared && b.name === MY_BOARD_NAME);
  const existing = mine?.buttons ?? [];
  if (existing.some((b) => b.soundId === sound.id) || existing.length >= MAX_BOARD_BUTTONS) {
    return undefined;
  }
  return {
    id: mine?.id,
    body: {
      name: MY_BOARD_NAME,
      buttons: [
        ...existing,
        { label: sound.name, soundId: sound.id, mode: 'oneshot', volume: 1, note: '' },
      ],
    },
  };
}
