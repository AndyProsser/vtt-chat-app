import { describe, expect, it } from 'vitest';

import type { Member } from '../types/index.js';
import { PICKER_ROWS, playerLines } from './players.js';

const member = (over: Partial<Member>): Member => ({
  userId: 'u',
  displayName: 'Sam',
  role: 'player',
  character: null,
  online: true,
  inVoice: false,
  muted: true,
  status: 'online',
  ...over,
});

describe('playerLines', () => {
  it('names a player by their character, with their own name beneath', () => {
    expect(playerLines(member({ character: { name: 'Aria Windfoot' } }))).toEqual({
      primary: 'Aria Windfoot',
      secondary: 'Sam',
    });
  });
  it('uses just their own name when they have no character', () => {
    expect(playerLines(member({}))).toEqual({ primary: 'Sam' });
  });
  it('shows six rows before it scrolls', () => {
    expect(PICKER_ROWS).toBe(6);
  });
});
