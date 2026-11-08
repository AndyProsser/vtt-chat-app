// Random treasure by challenge rating.
//
// The System Reference Document does not include treasure tables (they are in the Dungeon Master's
// Guide, which is not open content), so this is **our own generator**: the same *idea* — a few
// challenge-rating bands, coin-only "individual" treasure and fuller "hoards" — with our own dice and
// weights, drawing magic items from the SRD list by rarity. Treat the numbers as a rough guide to be
// edited, not as the DMG's tables. The DM sees every roll as a preview and can re-roll, remove, add.

import {
  SRD_ITEMS,
  findItem,
  type ItemType,
  type Rarity,
  type SrdItem,
} from '@vtt-chat-app/shared';

export type Rng = () => number;

/** One thing a roll produced, before the DM has dropped it. */
export interface Draft {
  name: string;
  kind: 'item' | 'coin';
  quantity: number;
  description?: string;
  itemType: ItemType;
  rarity: Rarity | null;
  srdId?: string;
}

export type Band = 1 | 2 | 3 | 4;

/** Challenge rating → treasure band: 0–4, 5–10, 11–16, 17 and up. */
export function bandOf(cr: number): Band {
  return cr <= 4 ? 1 : cr <= 10 ? 2 : cr <= 16 ? 3 : 4;
}

const die = (sides: number, rng: Rng) => 1 + Math.floor(rng() * sides);
const dice = (n: number, sides: number, rng: Rng) => {
  let total = 0;
  for (let i = 0; i < n; i += 1) total += die(sides, rng);
  return total;
};

type Coin = 'cp' | 'sp' | 'gp' | 'pp';
/** `[coin, dice count, sides, multiplier]`. */
type CoinRoll = readonly [Coin, number, number, number];

const INDIVIDUAL: Record<Band, readonly CoinRoll[]> = {
  1: [
    ['sp', 3, 6, 10],
    ['gp', 2, 6, 1],
  ],
  2: [
    ['sp', 2, 6, 10],
    ['gp', 4, 6, 10],
  ],
  3: [
    ['gp', 4, 6, 100],
    ['pp', 1, 6, 10],
  ],
  4: [
    ['gp', 2, 6, 1000],
    ['pp', 2, 6, 100],
  ],
};

const HOARD_COIN: Record<Band, readonly CoinRoll[]> = {
  1: [
    ['cp', 6, 6, 100],
    ['sp', 3, 6, 100],
    ['gp', 2, 6, 10],
  ],
  2: [
    ['sp', 2, 6, 100],
    ['gp', 6, 6, 100],
  ],
  3: [
    ['gp', 4, 6, 1000],
    ['pp', 5, 6, 100],
  ],
  4: [
    ['gp', 12, 6, 1000],
    ['pp', 8, 6, 100],
  ],
};

type Weighted<T> = readonly (readonly [T, number])[];

function pickWeighted<T>(table: Weighted<T>, rng: Rng): T {
  const total = table.reduce((n, [, w]) => n + w, 0);
  let roll = rng() * total;
  for (const [value, weight] of table) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return table[table.length - 1]![0];
}

const GEM_TIERS: Record<Band, Weighted<number>> = {
  1: [
    [10, 60],
    [50, 40],
  ],
  2: [
    [50, 40],
    [100, 40],
    [500, 20],
  ],
  3: [
    [100, 30],
    [500, 40],
    [1000, 30],
  ],
  4: [
    [1000, 50],
    [5000, 50],
  ],
};
const ART_TIERS: Record<Band, Weighted<number>> = {
  1: [[25, 100]],
  2: [
    [25, 30],
    [250, 70],
  ],
  3: [
    [250, 40],
    [750, 60],
  ],
  4: [
    [750, 30],
    [2500, 50],
    [7500, 20],
  ],
};
/** How many gems / art objects / magic items a hoard has: `[dice count, sides, offset]`. */
const GEM_COUNT: Record<Band, readonly [number, number, number]> = {
  1: [1, 4, -1],
  2: [1, 6, 0],
  3: [2, 4, 0],
  4: [3, 6, 0],
};
const ART_COUNT: Record<Band, readonly [number, number, number]> = {
  1: [1, 3, -1],
  2: [1, 4, -1],
  3: [1, 4, 0],
  4: [1, 6, 0],
};
const MAGIC_COUNT: Record<Band, readonly [number, number, number]> = {
  1: [1, 3, -1],
  2: [1, 3, 0],
  3: [1, 4, 0],
  4: [1, 4, 1],
};

/** Magic item rarity by band. Artifacts are story items and never roll. */
const MAGIC_RARITY: Record<Band, Weighted<Rarity>> = {
  1: [
    ['common', 40],
    ['uncommon', 50],
    ['rare', 10],
  ],
  2: [
    ['common', 15],
    ['uncommon', 45],
    ['rare', 35],
    ['very rare', 5],
  ],
  3: [
    ['uncommon', 15],
    ['rare', 45],
    ['very rare', 35],
    ['legendary', 5],
  ],
  4: [
    ['rare', 15],
    ['very rare', 45],
    ['legendary', 40],
  ],
};

const GEMS: Record<number, readonly string[]> = {
  10: ['Banded agate', 'Blue quartz', 'Hematite', 'Moss agate', 'Obsidian', 'Tiger eye'],
  50: ['Bloodstone', 'Carnelian', 'Citrine', 'Jasper', 'Moonstone', 'Onyx'],
  100: ['Amber', 'Amethyst', 'Garnet', 'Jade', 'Pearl', 'Spinel'],
  500: ['Alexandrite', 'Aquamarine', 'Black pearl', 'Peridot', 'Topaz'],
  1000: ['Black opal', 'Fire opal', 'Sapphire', 'Star ruby', 'Emerald'],
  5000: ['Black sapphire', 'Diamond', 'Jacinth', 'Ruby'],
};
const ART: Record<number, readonly string[]> = {
  25: [
    'Silver ewer',
    'Carved bone statuette',
    'Small gold bracelet',
    'Cloth-of-gold vestments',
    'Brass mug with jade inlay',
  ],
  250: [
    'Gold ring set with bloodstones',
    'Carved ivory statuette',
    'Silver chalice set with moonstones',
    'Large gold bracelet',
  ],
  750: [
    'Silver-plated steel longsword with jet set in hilt',
    'Gold music box',
    'Jeweled gold crown',
    'Painted gold war mask',
  ],
  2500: [
    'Jeweled platinum ring',
    'Gold cup set with emeralds',
    'Fine gold chain set with a fire opal',
    'Gold statuette set with rubies',
  ],
  7500: [
    'Jeweled gold crown',
    'Jeweled platinum ring of an ancient house',
    'Gold and sapphire tiara',
  ],
};

const count = ([n, sides, offset]: readonly [number, number, number], rng: Rng) =>
  Math.max(0, dice(n, sides, rng) + offset);

function coins(table: readonly CoinRoll[], rng: Rng): Draft[] {
  return table.map(([coin, n, sides, multiplier]) => ({
    name: coin,
    kind: 'coin' as const,
    quantity: dice(n, sides, rng) * multiplier,
    itemType: 'coin' as const,
    rarity: null,
  }));
}

function pick<T>(list: readonly T[], rng: Rng): T {
  return list[Math.floor(rng() * list.length)]!;
}

function gem(tier: number, rng: Rng): Draft {
  return {
    name: `${pick(GEMS[tier]!, rng)} (${tier} gp)`,
    kind: 'item',
    quantity: 1,
    description: `A gem worth ${tier} gp.`,
    itemType: 'gem',
    rarity: null,
  };
}

function art(tier: number, rng: Rng): Draft {
  return {
    name: `${pick(ART[tier]!, rng)} (${tier} gp)`,
    kind: 'item',
    quantity: 1,
    description: `An art object worth ${tier} gp.`,
    itemType: 'art',
    rarity: null,
  };
}

const MAGIC_POOL: readonly SrdItem[] = SRD_ITEMS.filter(
  (i) => i.magic && i.rarity !== null && i.rarity !== 'artifact',
);

function fromItem(item: SrdItem): Draft {
  return {
    name: item.name,
    kind: 'item',
    quantity: 1,
    ...(item.blurb ? { description: item.blurb } : {}),
    itemType: item.type,
    rarity: item.rarity,
    srdId: item.id,
  };
}

function magicItem(rarity: Rarity, rng: Rng, not?: string): Draft {
  const pool = MAGIC_POOL.filter((i) => i.rarity === rarity && i.id !== not);
  return fromItem(pick(pool.length > 0 ? pool : MAGIC_POOL.filter((i) => i.id !== not), rng));
}

/** Coin carried by a creature or small group. */
export function rollIndividual(cr: number, rng: Rng = Math.random): Draft[] {
  return coins(INDIVIDUAL[bandOf(cr)], rng);
}

/** A hoard: coin, gems, art objects and magic items. */
export function rollHoard(cr: number, rng: Rng = Math.random): Draft[] {
  const band = bandOf(cr);
  const drafts = coins(HOARD_COIN[band], rng);
  for (let i = count(GEM_COUNT[band], rng); i > 0; i -= 1)
    drafts.push(gem(pickWeighted(GEM_TIERS[band], rng), rng));
  for (let i = count(ART_COUNT[band], rng); i > 0; i -= 1)
    drafts.push(art(pickWeighted(ART_TIERS[band], rng), rng));
  for (let i = count(MAGIC_COUNT[band], rng); i > 0; i -= 1) {
    drafts.push(magicItem(pickWeighted(MAGIC_RARITY[band], rng), rng));
  }
  return drafts;
}

const GEM_VALUE = /\((\d+) gp\)$/;

/** Replaces one entry with another of the same kind: the same coin, a gem or art object of the same
 * value tier, or a different magic item of the same rarity. A custom or unknown entry is returned as is. */
export function rerollDraft(draft: Draft, cr: number, rng: Rng = Math.random): Draft {
  const band = bandOf(cr);
  if (draft.kind === 'coin') {
    const table = [...INDIVIDUAL[band], ...HOARD_COIN[band]].find(([coin]) => coin === draft.name);
    return table ? coins([table], rng)[0]! : draft;
  }
  if (draft.srdId && draft.rarity && findItem(draft.srdId))
    return magicItem(draft.rarity, rng, draft.srdId);
  const tier = Number(GEM_VALUE.exec(draft.name)?.[1]);
  if (draft.itemType === 'gem' && GEMS[tier]) return gem(tier, rng);
  if (draft.itemType === 'art' && ART[tier]) return art(tier, rng);
  return draft;
}
