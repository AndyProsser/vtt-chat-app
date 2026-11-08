import { describe, expect, it } from 'vitest';

import type { ChatLine, Member, TableCard } from '../types/index.js';
import { cardLabel, timeline } from './timeline.js';

const line = (id: string, at: number): ChatLine => ({
  id,
  from: { userId: 'u', name: 'U' },
  text: id,
  at,
});
const card = (id: string, after: string | null, over: Partial<TableCard> = {}): TableCard => ({
  id,
  kind: 'loot',
  title: 'Potion',
  quantity: 1,
  claimedBy: null,
  after,
  ...over,
});
const member = (userId: string, displayName: string, character?: string): Member => ({
  userId,
  displayName,
  role: 'player',
  character: character ? { name: character } : null,
  online: true,
  inVoice: false,
  muted: true,
});

describe('timeline', () => {
  it('puts each card right after the chat line it follows', () => {
    const entries = timeline([line('a', 1), line('b', 2)], [card('c1', 'a'), card('c2', null)]);
    expect(entries.map((e) => (e.type === 'line' ? e.line.id : e.card.id))).toEqual([
      'c2',
      'a',
      'c1',
      'b',
    ]);
  });

  it('hides removed cards and keeps a card whose anchor line has scrolled away', () => {
    const entries = timeline(
      [line('b', 2)],
      [card('gone', 'b', { removed: true }), card('orphan', 'trimmed')],
    );
    expect(entries.map((e) => (e.type === 'line' ? e.line.id : e.card.id))).toEqual([
      'orphan',
      'b',
    ]);
  });
});

describe('cardLabel', () => {
  const members = [member('u1', 'Amy', 'Aria'), member('u2', 'Bob')];
  it('says who took a loot item, preferring the character name', () => {
    expect(cardLabel(card('l', null, { quantity: 2 }), members)).toBe('Potion ×2 · available');
    expect(cardLabel(card('l', null, { claimedBy: 'u1' }), members)).toBe('Potion · taken by Aria');
    expect(cardLabel(card('l', null, { claimedBy: 'u2' }), members)).toBe('Potion · taken by Bob');
    expect(cardLabel(card('l', null, { claimedBy: 'ghost' }), members)).toBe(
      'Potion · taken by someone',
    );
  });
  it('labels a handout', () => {
    expect(cardLabel(card('h', null, { kind: 'handout', title: 'Crypt map' }), members)).toBe(
      'Handout: Crypt map',
    );
  });
});
