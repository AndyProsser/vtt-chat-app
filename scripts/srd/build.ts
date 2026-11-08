// Builds shared/src/srd/data.generated.ts from the System Reference Document 5.1.
//
//   node scripts/srd/build.ts
//
// The SRD 5.1 is © Wizards of the Coast LLC and licensed CC-BY-4.0 (attribution: docs/LEGAL-SRD.md).
// The text is read from a pinned commit of a public Markdown conversion of the SRD, so the output is
// reproducible. The raw Markdown is downloaded to a temp folder and not committed; the generated
// file is. Treasure *tables* are not in the SRD (they are DMG-only), so none are read here.

import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { ROOT } from '../dev/lib.ts';

const SHA = 'bf6ac2ae7e778397ca7326ca991706daf70c13c2';
const RAW = `https://raw.githubusercontent.com/BTMorton/dnd-5e-srd/${SHA}/markdown`;

type ItemType = string;
interface Item {
  id: string;
  name: string;
  type: ItemType;
  magic: boolean;
  rarity: string | null;
  attunement?: boolean;
  valueGp?: number;
  blurb?: string;
}

async function fetchText(file: string): Promise<string> {
  const response = await fetch(`${RAW}/${encodeURIComponent(file)}`);
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  return (await response.text()).replace(/\r\n/g, "\n");
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];

function earliestRarity(text: string): string | undefined {
  let best: { rarity: string; at: number } | undefined;
  for (const rarity of RARITIES) {
    const at = text.search(new RegExp(`\\b${rarity}\\b`));
    if (at >= 0 && (!best || at < best.at)) best = { rarity, at };
  }
  return best?.rarity;
}

/** Items whose SRD category line gives no single rarity, with the rarity we file them under. */
const RARITY_OVERRIDES: Record<string, string> = {
  'Belt of Giant Strength': 'rare', // hill giant; stronger giants are higher
  'Figurine of Wondrous Power': 'rare', // varies by figurine
  'Ioun Stone': 'rare', // varies by stone
  'Potion of Giant Strength': 'uncommon', // hill giant; stronger giants are higher
  'Potion of Healing': 'common', // greater/superior/supreme are higher
  'Spell Scroll': 'uncommon', // by spell level
};

function magicType(category: string): ItemType {
  const c = category.toLowerCase();
  if (c.startsWith('wondrous')) return 'wondrous';
  if (c.startsWith('weapon')) return c.includes('ammunition') ? 'ammunition' : 'weapon';
  if (c.startsWith('armor')) return /\(shield\)/.test(c) ? 'shield' : 'armor';
  for (const t of ['potion', 'ring', 'rod', 'scroll', 'staff', 'wand']) if (c.startsWith(t)) return t;
  return 'other';
}

function parseMagic(md: string): Item[] {
  const items: Item[] = [];
  const re = /^#### (.+)\n\n\*(.+?)\*\n\n([\s\S]*?)(?=\n#### |\n### |$(?![\s\S]))/gm;
  for (const m of md.matchAll(re)) {
    const [, name, category, body] = m as unknown as [string, string, string, string];
    const lower = category.toLowerCase();
    // The first rarity named: items that come in several ("uncommon (+1), rare (+2)…") are filed at the lowest.
    const found = earliestRarity(lower);
    const rarity = RARITY_OVERRIDES[name] ?? found;
    if (!rarity) throw new Error(`no rarity for ${name}: ${category}`);
    const sentence = body.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
    items.push({
      id: slug(name),
      name,
      type: magicType(category),
      magic: true,
      rarity,
      ...(lower.includes('requires attunement') ? { attunement: true } : {}),
      ...(sentence ? { blurb: sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence } : {}),
    });
  }
  return items;
}

const COIN_GP: Record<string, number> = { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 10 };

function costGp(cell: string): number | undefined {
  const m = /^([\d,]+(?:\.\d+)?)\s*(cp|sp|ep|gp|pp)\b/.exec(cell.trim());
  if (!m) return undefined;
  return Math.round(Number(m[1]!.replace(/,/g, '')) * COIN_GP[m[2]!]! * 100) / 100;
}

/** equipment.md section heading → the item type of the table's rows. */
const SECTIONS: Record<string, ItemType> = {
  'Light Armor': 'armor',
  'Medium Armor': 'armor',
  'Heavy Armor': 'armor',
  Shield: 'shield',
  'Simple Melee Weapons': 'weapon',
  'Simple Ranged Weapons': 'weapon',
  'Martial Melee Weapons': 'weapon',
  'Martial Ranged Weapons': 'weapon',
  'Adventuring Gear': 'gear',
  Tools: 'tool',
  'Mounts and Other Animals': 'mount',
  'Tack, Harness, and Drawn Vehicles': 'mount',
  'Waterborne Vehicles': 'mount',
};

function parseMundane(md: string): Item[] {
  const items: Item[] = [];
  let type: ItemType | undefined;
  let costColumn = 1;
  let nameColumn = 0;
  for (const line of md.split('\n')) {
    const heading = /^#{3,5}\s+(.+)$/.exec(line);
    if (heading) {
      type = SECTIONS[heading[1]!.trim()];
      continue;
    }
    if (!type || !line.startsWith('|') || /^\|[-\s|]+\|?$/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (/^(armor|item|name|weapon)$/i.test(cells[0] ?? '')) {
      costColumn = 1;
      nameColumn = 0;
      continue;
    }
    const raw = (cells[nameColumn] ?? '').replace(/\*/g, '').trim();
    const value = costGp(cells[costColumn] ?? '');
    if (!raw || value === undefined) continue; // category rows ("*Ammunition*") have no cost
    items.push({
      id: slug(raw),
      name: raw.replace(/\s+/g, ' '),
      type: /arrows|bolts|bullets|needles/i.test(raw) && type === 'gear' ? 'ammunition' : type,
      magic: false,
      rarity: null,
      valueGp: value,
    });
  }
  return items;
}

function unique(items: Item[]): Item[] {
  const seen = new Map<string, number>();
  return items.map((i) => {
    const n = (seen.get(i.id) ?? 0) + 1;
    seen.set(i.id, n);
    return n === 1 ? i : { ...i, id: `${i.id}-${n}` };
  });
}

async function main(): Promise<void> {
  const magic = parseMagic(await fetchText('10 magic items.md'));
  const mundane = parseMundane(await fetchText('04 equipment.md'));
  const items = unique([...magic, ...mundane]);
  const header = `// GENERATED by scripts/srd/build.ts from the System Reference Document 5.1 — do not edit by hand.
// SRD 5.1 © Wizards of the Coast LLC, licensed CC-BY-4.0: see docs/LEGAL-SRD.md for the attribution.
// Source: github.com/BTMorton/dnd-5e-srd @ ${SHA}
import type { SrdItem } from './types.js';

`;
  const body = `export const SRD_ITEMS: readonly SrdItem[] = ${JSON.stringify(items, null, 2)} as SrdItem[];\n`;
  const out = path.join(ROOT, 'shared', 'src', 'srd', 'data.generated.ts');
  writeFileSync(out, header + body);
  console.log(`${magic.length} magic items, ${mundane.length} mundane items → ${path.relative(ROOT, out)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
