import {
  Anchor,
  Beer,
  Building2,
  Castle,
  Church,
  Clapperboard,
  CloudLightning,
  CloudRain,
  Droplets,
  Flame,
  Mountain,
  Moon,
  Music,
  Skull,
  Snowflake,
  Store,
  Sun,
  Swords,
  TreePine,
  Waves,
  Wind,
  type LucideIcon,
} from 'lucide-react';

// First rule whose keyword appears in the (lower-cased) scene name wins, so list the specific ones first.
const RULES: ReadonlyArray<readonly [string, LucideIcon]> = [
  ['thunder', CloudLightning],
  ['storm', CloudLightning],
  ['rain', CloudRain],
  ['battle', Swords],
  ['fight', Swords],
  ['combat', Swords],
  ['war', Swords],
  ['tavern', Beer],
  ['inn', Beer],
  ['pub', Beer],
  ['market', Store],
  ['bazaar', Store],
  ['city', Building2],
  ['town', Building2],
  ['village', Building2],
  ['street', Building2],
  ['forest', TreePine],
  ['wood', TreePine],
  ['jungle', TreePine],
  ['cave', Mountain],
  ['mountain', Mountain],
  ['dungeon', Skull],
  ['crypt', Skull],
  ['tomb', Skull],
  ['castle', Castle],
  ['temple', Church],
  ['church', Church],
  ['ship', Anchor],
  ['harbour', Anchor],
  ['harbor', Anchor],
  ['sea', Waves],
  ['ocean', Waves],
  ['river', Waves],
  ['swamp', Droplets],
  ['fire', Flame],
  ['camp', Flame],
  ['snow', Snowflake],
  ['ice', Snowflake],
  ['desert', Sun],
  ['wind', Wind],
  ['night', Moon],
  ['music', Music],
];

/** The icon for a scene, from its name; the tooltip carries the name itself. */
export function sceneIcon(name: string): LucideIcon {
  const t = name.toLowerCase();
  // Whole-word match for the short words ("inn", "war", "sea") so "winner" or "seafood" do not match them.
  const words = new Set(t.split(/[^a-z]+/));
  const hit = RULES.find(([word]) => (word.length <= 3 ? words.has(word) : t.includes(word)));
  return hit?.[1] ?? Clapperboard;
}
