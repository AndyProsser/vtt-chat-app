import type { LootDraft, SrdItem } from '../types/index.js';

/** A catalog item as a draft ready to be dropped (one of them). */
export function draftFromItem(item: SrdItem): LootDraft {
  return {
    name: item.name,
    kind: 'item',
    quantity: 1,
    itemType: item.type,
    rarity: item.rarity,
    srdId: item.id,
    ...(item.blurb ? { description: item.blurb } : {}),
  };
}

/** A custom entry from the form: coin is always type `coin` with no rarity. */
export function customDraft(input: {
  name: string;
  quantity: number;
  coin: boolean;
  itemType: LootDraft['itemType'];
  rarity: LootDraft['rarity'];
}): LootDraft | undefined {
  const name = input.name.trim();
  const quantity = Math.floor(input.quantity);
  if (!name || !Number.isFinite(quantity) || quantity < 1) return undefined;
  return input.coin
    ? { name, kind: 'coin', quantity, itemType: 'coin', rarity: null }
    : { name, kind: 'item', quantity, itemType: input.itemType, rarity: input.rarity };
}

/** The `loot/batch` body for a staged list. */
export function batchBody(drafts: LootDraft[]): { items: Record<string, unknown>[] } {
  return {
    items: drafts.map((d) => ({
      name: d.name,
      kind: d.kind,
      quantity: d.quantity,
      itemType: d.itemType,
      rarity: d.rarity,
      ...(d.description ? { description: d.description } : {}),
      ...(d.srdId ? { srdId: d.srdId } : {}),
    })),
  };
}

/** Replaces entry `index` of `list`, or removes it when `next` is undefined. */
export function replaceAt<T>(list: T[], index: number, next: T | undefined): T[] {
  return next === undefined
    ? list.filter((_, i) => i !== index)
    : list.map((x, i) => (i === index ? next : x));
}
