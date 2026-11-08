import {
  Backpack,
  Coins,
  Crosshair,
  FlaskConical,
  Gem,
  Hammer,
  CircleDot,
  Package,
  Palette,
  PawPrint,
  Pipette,
  ScrollText,
  Shield,
  ShieldHalf,
  Slash,
  Sparkles,
  Sword,
  Wheat,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';

import { glowLevel, rarityLabel, typeLabel } from '../lib/itemStyle.js';
import type { ItemType, Rarity } from '../types/index.js';

const ICON: Record<ItemType, LucideIcon> = {
  weapon: Sword,
  ammunition: Crosshair,
  armor: ShieldHalf,
  shield: Shield,
  potion: FlaskConical,
  scroll: ScrollText,
  ring: CircleDot,
  rod: Pipette,
  staff: Slash,
  wand: WandSparkles,
  wondrous: Sparkles,
  gear: Backpack,
  tool: Hammer,
  mount: PawPrint,
  trade: Wheat,
  gem: Gem,
  art: Palette,
  coin: Coins,
  other: Package,
};

/** An item's type as an icon; magic items carry a soft glow that is stronger the rarer they are. */
export function ItemIcon({
  type,
  rarity,
  size = 18,
}: {
  type: ItemType;
  rarity: Rarity | null;
  size?: number;
}) {
  const Icon = ICON[type];
  const rarityText = rarityLabel(rarity);
  return (
    <span
      className="vtt-item-icon"
      data-rarity={rarity ?? 'none'}
      data-glow={glowLevel(rarity)}
      title={`${typeLabel(type)}${rarityText ? `, ${rarityText.toLowerCase()}` : ''}`}
    >
      <Icon size={size} aria-label={typeLabel(type)} />
    </span>
  );
}
