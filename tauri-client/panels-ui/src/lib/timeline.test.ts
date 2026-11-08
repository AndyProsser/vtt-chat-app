import { describe, expect, it } from 'vitest';

import type { ChatLine, Member, TableCard } from '../types/index.js';
import { cardLabel, itemLabel, timeline } from './timeline.js';

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
  it('says when an item was taken for the party', () => {
    expect(cardLabel(card('l', null, { claimedBy: 'u1', claimedFor: 'party' }), members)).toBe(
      'Potion · taken by Aria for the party',
    );
  });
  it('words coin as an amount, and a split with each share and what is left over', () => {
    const coin = { kind: 'loot' as const, coin: true, title: 'gp', quantity: 10 };
    expect(cardLabel(card('c', null, coin), members)).toBe('10 gp · available');
    expect(
      cardLabel(
        card('c', null, {
          ...coin,
          claimedBy: 'u1',
          claimedFor: 'split',
          split: {
            shares: [
              { userId: 'u1', amount: 3 },
              { userId: 'u2', amount: 3 },
            ],
            remainder: 4,
          },
        }),
        members,
      ),
    ).toBe('10 gp · split 3 each among 2 (4 left over)');
    expect(
      cardLabel(
        card('c', null, {
          ...coin,
          claimedBy: 'u2',
          claimedFor: 'split',
          split: {
            shares: [
              { userId: 'u1', amount: 5 },
              { userId: 'u2', amount: 5 },
            ],
            remainder: 0,
          },
        }),
        members,
      ),
    ).toBe('10 gp · split 5 each among 2');
  });
  it('labels a handout', () => {
    expect(cardLabel(card('h', null, { kind: 'handout', title: 'Crypt map' }), members)).toBe(
      'Handout: Crypt map',
    );
  });
});

describe('itemLabel', () => {
  const members = [member('u1', 'Amy', 'Aria')];
  it('words a REST loot item the same way as its card', () => {
    const item = {
      id: 'i',
      kind: 'item' as const,
      name: 'Rope',
      description: '',
      quantity: 2,
      claimedBy: 'u1',
      claimedFor: 'party' as const,
      split: null,
    };
    expect(itemLabel(item, members)).toBe('Rope ×2 · taken by Aria for the party');
    expect(
      itemLabel(
        { ...item, kind: 'coin', name: 'gp', quantity: 5, claimedBy: null, claimedFor: null },
        members,
      ),
    ).toBe('5 gp · available');
  });
});
