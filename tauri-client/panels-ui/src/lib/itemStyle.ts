import type { ItemType, Rarity } from '../types/index.js';

/** The SRD's rarity names, weakest first. */
export const RARITIES: readonly Rarity[] = [
  'common',
  'uncommon',
  'rare',
  'very rare',
  'legendary',
  'artifact',
];

export const ITEM_TYPES: readonly ItemType[] = [
  'weapon',
  'ammunition',
  'armor',
  'shield',
  'potion',
  'scroll',
  'ring',
  'rod',
  'staff',
  'wand',
  'wondrous',
  'gear',
  'tool',
  'mount',
  'trade',
  'gem',
  'art',
  'coin',
  'other',
];

/** How strongly a magic item glows: 0 for none, then 1–6 up the rarity ladder. */
export function glowLevel(rarity: Rarity | null): number {
  return rarity === null ? 0 : RARITIES.indexOf(rarity) + 1;
}

export function rarityLabel(rarity: Rarity | null): string {
  return rarity === null ? '' : rarity[0]!.toUpperCase() + rarity.slice(1);
}

const TYPE_LABEL: Record<ItemType, string> = {
  weapon: 'Weapon',
  ammunition: 'Ammunition',
  armor: 'Armor',
  shield: 'Shield',
  potion: 'Potion',
  scroll: 'Scroll',
  ring: 'Ring',
  rod: 'Rod',
  staff: 'Staff',
  wand: 'Wand',
  wondrous: 'Wondrous item',
  gear: 'Adventuring gear',
  tool: 'Tool',
  mount: 'Mount or vehicle',
  trade: 'Trade good',
  gem: 'Gem',
  art: 'Art object',
  coin: 'Coin',
  other: 'Item',
};

export const typeLabel = (type: ItemType): string => TYPE_LABEL[type];
