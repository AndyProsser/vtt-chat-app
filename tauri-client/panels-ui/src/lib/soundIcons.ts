import {
  Axe,
  BookOpen,
  Bell,
  Coins,
  DoorClosed,
  DoorOpen,
  Droplets,
  Footprints,
  Gem,
  Grip,
  Hammer,
  Hand,
  Layers,
  Mountain,
  Shirt,
  Snowflake,
  Sparkles,
  Sprout,
  TreePine,
  Volume2,
  Wine,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/** First rule whose keyword appears in the (lower-cased) text wins. */
function pick(
  text: string,
  rules: ReadonlyArray<readonly [string, LucideIcon]>,
  fallback: LucideIcon,
) {
  const t = text.toLowerCase();
  return rules.find(([word]) => t.includes(word))?.[1] ?? fallback;
}

const BOARD_RULES = [
  ['door', DoorOpen],
  ['foot', Footprints],
  ['impact', Hammer],
  ['book', BookOpen],
  ['cloth', Shirt],
  ['metal', Wrench],
  ['handle', Hand],
] as const;

const SOUND_RULES = [
  ['close', DoorClosed],
  ['open', DoorOpen],
  ['coin', Coins],
  ['bell', Bell],
  ['glass', Wine],
  ['wood', TreePine],
  ['plank', TreePine],
  ['grass', Sprout],
  ['snow', Snowflake],
  ['carpet', Layers],
  ['concrete', Mountain],
  ['gem', Gem],
  ['metal', Hammer],
  ['axe', Axe],
  ['splash', Droplets],
  ['water', Droplets],
  ['leather', Grip],
  ['cloth', Shirt],
] as const;

/** The icon for a sound board, from its name. */
export function boardIcon(name: string): LucideIcon {
  return pick(name, BOARD_RULES, Sparkles);
}

/** The icon for one sound button, from its label (the tooltip still carries the full name). */
export function soundIcon(label: string): LucideIcon {
  return pick(label, SOUND_RULES, Volume2);
}
