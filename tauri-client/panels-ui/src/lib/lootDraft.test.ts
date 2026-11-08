import { describe, expect, it } from 'vitest';

import type { LootDraft, SrdItem } from '../types/index.js';
import { batchBody, customDraft, draftFromItem, replaceAt, withAssignee } from './lootDraft.js';

const potion: SrdItem = {
  id: 'potion-of-healing',
  name: 'Potion of Healing',
  type: 'potion',
  magic: true,
  rarity: 'common',
  blurb: 'You regain hit points.',
};

describe('drafts', () => {
  it('turns a catalog item into one draft that keeps its SRD identity', () => {
    expect(draftFromItem(potion)).toEqual({
      name: 'Potion of Healing',
      kind: 'item',
      quantity: 1,
      itemType: 'potion',
      rarity: 'common',
      srdId: 'potion-of-healing',
      description: 'You regain hit points.',
    });
  });

  it('builds a custom item or a coin pile, and refuses a blank name or a bad amount', () => {
    expect(
      customDraft({
        name: ' Old key ',
        quantity: 2,
        coin: false,
        itemType: 'gear',
        rarity: 'rare',
      }),
    ).toEqual({ name: 'Old key', kind: 'item', quantity: 2, itemType: 'gear', rarity: 'rare' });
    expect(
      customDraft({ name: 'gp', quantity: 50, coin: true, itemType: 'gear', rarity: 'rare' }),
    ).toEqual({
      name: 'gp',
      kind: 'coin',
      quantity: 50,
      itemType: 'coin',
      rarity: null,
    });
    expect(
      customDraft({ name: ' ', quantity: 1, coin: false, itemType: 'gear', rarity: null }),
    ).toBeUndefined();
    expect(
      customDraft({ name: 'x', quantity: 0, coin: false, itemType: 'gear', rarity: null }),
    ).toBeUndefined();
    expect(
      customDraft({ name: 'x', quantity: Number.NaN, coin: false, itemType: 'gear', rarity: null }),
    ).toBeUndefined();
  });

  it('sends only what the server takes, leaving out empty description and srdId', () => {
    const drafts: LootDraft[] = [
      { name: 'gp', kind: 'coin', quantity: 5, itemType: 'coin', rarity: null },
      { ...draftFromItem(potion) },
    ];
    const body = batchBody(drafts);
    expect(body.items[0]).toEqual({
      name: 'gp',
      kind: 'coin',
      quantity: 5,
      itemType: 'coin',
      rarity: null,
    });
    expect(body.items[1]).toMatchObject({
      srdId: 'potion-of-healing',
      description: 'You regain hit points.',
    });
  });

  it('passes along who a draft is to be given to', () => {
    const draft: LootDraft = { ...draftFromItem(potion), assignTo: 'alice' };
    expect(batchBody([draft]).items[0]).toMatchObject({ assignTo: 'alice' });
    expect(batchBody([draftFromItem(potion)]).items[0]).not.toHaveProperty('assignTo');
  });

  it('replaces or removes one entry without touching the others', () => {
    expect(replaceAt(['a', 'b', 'c'], 1, 'x')).toEqual(['a', 'x', 'c']);
    expect(replaceAt(['a', 'b', 'c'], 1, undefined)).toEqual(['a', 'c']);
  });
});

describe('withAssignee', () => {
  it('gives a draft to a player and back to the pool, without touching the original', () => {
    const draft = draftFromItem(potion);
    const given = withAssignee(draft, 'alice');
    expect(given.assignTo).toBe('alice');
    expect(withAssignee(given, '')).not.toHaveProperty('assignTo');
    expect(draft).not.toHaveProperty('assignTo');
  });
});
