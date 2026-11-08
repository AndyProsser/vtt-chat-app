import {
  Axe,
  Crown,
  FlaskConical,
  Flame,
  Gem,
  Ghost,
  Leaf,
  Moon,
  ScrollText,
  Shield,
  Skull,
  Slash,
  Star,
  Sun,
  Sword,
  Target,
  WandSparkles,
  Bug,
  type LucideIcon,
} from 'lucide-react';

import { emblemOf, type Emblem } from '../lib/avatars.js';

const ICON: Record<Emblem, LucideIcon> = {
  sword: Sword,
  shield: Shield,
  axe: Axe,
  bow: Target,
  wand: WandSparkles,
  staff: Slash,
  scroll: ScrollText,
  potion: FlaskConical,
  crown: Crown,
  skull: Skull,
  ghost: Ghost,
  flame: Flame,
  leaf: Leaf,
  moon: Moon,
  sun: Sun,
  star: Star,
  gem: Gem,
  dragon: Bug,
};

export const EmblemIcon = ICON;

/** The inside of an avatar circle: the character's emblem if they picked one, else their initials. */
export function Portrait({
  avatarUrl,
  fallback,
  size = 16,
}: {
  avatarUrl?: string | null;
  fallback: string;
  size?: number;
}) {
  const emblem = emblemOf(avatarUrl);
  if (!emblem) return <>{fallback}</>;
  const Icon = ICON[emblem];
  return <Icon size={size} aria-label={emblem} />;
}
