import { describe, expect, it } from 'vitest';

import type { SoundBoard } from '../types/index.js';
import { boardWithSound, clipProblem, MY_BOARD_NAME, nameFromFile, ownSounds } from './mySounds.js';

describe('nameFromFile', () => {
  it('turns a file name into a readable sound name', () => {
    expect(nameFromFile('door_slam_02.ogg')).toBe('Door slam');
    expect(nameFromFile('.ogg')).toBe('New sound');
  });
});

describe('ownSounds', () => {
  it('keeps only the DM’s own sounds, by name', () => {
    const list = [
      { id: '1', name: 'Zap' },
      { id: '2', name: 'Catalogue thing', shared: true },
      { id: '3', name: 'Axe' },
    ];
    expect(ownSounds(list).map((s) => s.id)).toEqual(['3', '1']);
  });
});

describe('clipProblem', () => {
  it('accepts the four formats within 5 MB and says why otherwise', () => {
    expect(clipProblem({ name: 'a.OGG', size: 10 })).toBeUndefined();
    expect(clipProblem({ name: 'a.mp3', size: 5 * 1024 * 1024 })).toBeUndefined();
    expect(clipProblem({ name: 'a.txt', size: 10 })).toMatch(/OGG/);
    expect(clipProblem({ name: 'a.wav', size: 0 })).toMatch(/empty/);
    expect(clipProblem({ name: 'a.flac', size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
  });
});

describe('boardWithSound', () => {
  const button = (soundId: string) => ({
    id: `b-${soundId}`,
    label: soundId,
    soundId,
    mode: 'oneshot' as const,
    volume: 1,
    note: '',
  });
  it('makes the My sounds board when there is none', () => {
    const plan = boardWithSound([], { id: 's1', name: 'Door' });
    expect(plan?.id).toBeUndefined();
    expect(plan?.body.name).toBe(MY_BOARD_NAME);
    expect(plan?.body.buttons).toEqual([
      { label: 'Door', soundId: 's1', mode: 'oneshot', volume: 1, note: '' },
    ]);
  });
  it('adds to the board you already have, and never to a shared one of the same name', () => {
    const boards: SoundBoard[] = [
      { id: 'shared', name: MY_BOARD_NAME, shared: true, buttons: [button('x')] },
      { id: 'mine', name: MY_BOARD_NAME, buttons: [button('a')] },
    ];
    const plan = boardWithSound(boards, { id: 's2', name: 'Bell' });
    expect(plan?.id).toBe('mine');
    expect(plan?.body.buttons).toHaveLength(2);
  });
  it('does nothing when the sound is already there or the board is full', () => {
    const one: SoundBoard[] = [{ id: 'mine', name: MY_BOARD_NAME, buttons: [button('a')] }];
    expect(boardWithSound(one, { id: 'a', name: 'A' })).toBeUndefined();
    const full: SoundBoard[] = [
      {
        id: 'mine',
        name: MY_BOARD_NAME,
        buttons: Array.from({ length: 60 }, (_, i) => button(`s${i}`)),
      },
    ];
    expect(boardWithSound(full, { id: 'new', name: 'N' })).toBeUndefined();
  });
});
