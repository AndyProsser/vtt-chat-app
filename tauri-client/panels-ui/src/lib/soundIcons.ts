import {
  Anvil,
  Axe,
  BookOpen,
  Bell,
  Coins,
  CookingPot,
  DoorClosed,
  DoorOpen,
  Drum,
  Feather,
  Fence,
  Footprints,
  Gem,
  HandMetal,
  Hammer,
  Hand,
  KeyRound,
  Layers,
  Link,
  Lock,
  Mountain,
  Pickaxe,
  Shirt,
  Snowflake,
  Sparkles,
  Sprout,
  Sword,
  TreePine,
  Vibrate,
  Volume2,
  Wine,
  Zap,
  Briefcase,
  ArrowDownToLine,
  type LucideIcon,
} from 'lucide-react';

type Rules = ReadonlyArray<readonly [string, LucideIcon]>;

/** First rule whose keyword appears in the (lower-cased) text wins, so list the specific ones first. */
function pick(text: string, rules: Rules, fallback: LucideIcon): LucideIcon {
  const t = text.toLowerCase();
  return rules.find(([word]) => t.includes(word))?.[1] ?? fallback;
}

const BOARD_RULES: Rules = [
  ['door', DoorOpen],
  ['foot', Footprints],
  ['impact', Hammer],
  ['book', BookOpen],
  ['cloth', Shirt],
  ['metal', Anvil],
  ['handle', Hand],
];

// Matched against "<board> <label>". Order matters: a door's "close" must be seen before a book's.
const SOUND_RULES: Rules = [
  ['book', BookOpen],
  ['door close', DoorClosed],
  ['door open', DoorOpen],
  ['door', DoorOpen],
  ['creak', Vibrate],
  ['latch', Lock],
  ['click', KeyRound],
  ['pot', CookingPot],
  ['coin', Coins],
  ['small leather', Briefcase],
  ['drop', ArrowDownToLine],
  ['leather', Briefcase],
  ['belt', Link],
  ['cloth', Shirt],
  ['chop', Axe],
  ['knife', Sword],
  ['slice', Sword],
  ['bell', Bell],
  ['glass', Wine],
  ['mining', Pickaxe],
  ['plank', Fence],
  ['punch', HandMetal],
  ['soft', Feather],
  ['tin', Drum],
  ['plate', Anvil],
  ['gem', Gem],
  ['carpet', Layers],
  ['concrete', Mountain],
  ['grass', Sprout],
  ['snow', Snowflake],
  ['footstep wood', TreePine],
  ['wood', TreePine],
  ['footstep', Footprints],
  ['metal', Hammer],
  ['generic', Zap],
];

/** The icon for a sound board, from its name. */
export function boardIcon(name: string): LucideIcon {
  return pick(name, BOARD_RULES, Sparkles);
}

/** The icon for one sound, from its label and (when known) its board; the tooltip carries the full name. */
export function soundIcon(label: string, board = ''): LucideIcon {
  return pick(`${board} ${label}`, SOUND_RULES, Volume2);
}
