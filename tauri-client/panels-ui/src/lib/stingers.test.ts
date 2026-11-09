import { describe, expect, it } from 'vitest';

import type { SoundBoard, SoundButton } from '../types/index.js';
import { defaultPins, flattenSounds, searchSounds, togglePin, MAX_PINS } from './stingers.js';

const b = (label: string, soundId = label, mode: SoundButton['mode'] = 'oneshot'): SoundButton => ({
  id: `${soundId}-btn`,
  label,
  soundId,
  mode,
  volume: 1,
  note: '',
});
const boards: SoundBoard[] = [
  { id: '1', name: 'Door', buttons: [b('open'), b('close')] },
  { id: '2', name: 'Footstep', buttons: [b('grass'), b('open', 'open')] },
  { id: '3', name: 'Weather', buttons: [b('rain', 'rain', 'loop')] },
];

describe('flattenSounds', () => {
  it('lists each one-shot sound once, with its board name', () => {
    const sounds = flattenSounds(boards);
    expect(sounds.map((s) => s.soundId)).toEqual(['open', 'close', 'grass']);
    expect(sounds[0]).toMatchObject({ label: 'open', board: 'Door' });
  });
});

describe('searchSounds', () => {
  const sounds = flattenSounds(boards);
  it('matches the label or the board, ignoring case', () => {
    expect(searchSounds(sounds, 'GRA').map((s) => s.soundId)).toEqual(['grass']);
    expect(searchSounds(sounds, 'door').map((s) => s.soundId)).toEqual(['open', 'close']);
  });
  it('returns the first few for an empty query and nothing for no match', () => {
    expect(searchSounds(sounds, '  ')).toHaveLength(3);
    expect(searchSounds(sounds, 'zzz')).toEqual([]);
  });
});

describe('pins', () => {
  it('adds a sound, removes it again, and never exceeds the limit', () => {
    expect(togglePin(['a'], 'b')).toEqual(['a', 'b']);
    expect(togglePin(['a', 'b'], 'a')).toEqual(['b']);
    const full = Array.from({ length: MAX_PINS }, (_, i) => `s${i}`);
    expect(togglePin(full, 'new')).toEqual(full);
  });
  it('starts with the first few sounds pinned', () => {
    expect(defaultPins(flattenSounds(boards))).toEqual(['open', 'close', 'grass']);
  });
});
