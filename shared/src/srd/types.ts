/** What kind of thing an item is; drives its icon. */
export type ItemType =
  | 'weapon'
  | 'ammunition'
  | 'armor'
  | 'shield'
  | 'potion'
  | 'scroll'
  | 'ring'
  | 'rod'
  | 'staff'
  | 'wand'
  | 'wondrous'
  | 'gear'
  | 'tool'
  | 'mount'
  | 'trade'
  | 'gem'
  | 'art'
  | 'coin'
  | 'other';

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

/** The SRD's rarity names, weakest to strongest. Mundane items have none. */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'very rare' | 'legendary' | 'artifact';

export const RARITIES: readonly Rarity[] = [
  'common',
  'uncommon',
  'rare',
  'very rare',
  'legendary',
  'artifact',
];

export interface SrdItem {
  /** Stable slug, e.g. `potion-of-healing`. */
  id: string;
  name: string;
  type: ItemType;
  magic: boolean;
  /** Present for magic items. */
  rarity: Rarity | null;
  /** Magic items that need attunement. */
  attunement?: boolean;
  /** Price in gold pieces, for mundane items that have one. */
  valueGp?: number;
  /** A short description (first sentence of the SRD text) for a tooltip. */
  blurb?: string;
}

export function isItemType(value: unknown): value is ItemType {
  return typeof value === 'string' && (ITEM_TYPES as readonly string[]).includes(value);
}

export function isRarity(value: unknown): value is Rarity {
  return typeof value === 'string' && (RARITIES as readonly string[]).includes(value);
}
