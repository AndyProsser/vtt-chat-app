import type { BardId } from '@vtt-chat-app/shared';
import { Drama, Feather, Guitar, Landmark, Wine, type LucideIcon } from 'lucide-react';

/** A stand-in emblem for each storyteller until there is portrait art: one icon in a round, tinted badge. */
const EMBLEM: Record<BardId, LucideIcon> = {
  tavern: Guitar,
  dry: Feather,
  drunken: Wine,
  sarcastic: Drama,
  bored: Landmark,
};

export function BardAvatar({ id, size = 34 }: { id: BardId; size?: number }) {
  const Emblem = EMBLEM[id];
  return (
    <span className="vtt-bard-avatar" style={{ width: size, height: size }} aria-hidden>
      <Emblem size={Math.round(size * 0.52)} />
    </span>
  );
}
