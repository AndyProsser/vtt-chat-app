import { SRD_ITEMS } from './data.generated.js';
import type { ItemType, Rarity, SrdItem } from './types.js';

export function findItem(id: string): SrdItem | undefined {
  return SRD_ITEMS.find((i) => i.id === id);
}

export interface ItemQuery {
  query?: string;
  type?: ItemType;
  rarity?: Rarity;
  magic?: boolean;
  limit?: number;
}

/** Items matching every given filter, name matches that start a word ranked first. */
export function searchItems({ query, type, rarity, magic, limit = 50 }: ItemQuery): SrdItem[] {
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { item: SrdItem; score: number }[] = [];
  for (const item of SRD_ITEMS) {
    if (type !== undefined && item.type !== type) continue;
    if (rarity !== undefined && item.rarity !== rarity) continue;
    if (magic !== undefined && item.magic !== magic) continue;
    const name = item.name.toLowerCase();
    if (!words.every((w) => name.includes(w))) continue;
    const score = words.reduce(
      (n, w) => n + (name.startsWith(w) ? 2 : name.includes(` ${w}`) ? 1 : 0),
      0,
    );
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit).map((s) => s.item);
}
