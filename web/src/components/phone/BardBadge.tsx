import type { BardId } from '@vtt-chat-app/shared';

import { Icon, type IconName } from '@vtt-chat-app/ui-kit';

/** A round emblem for each storyteller (stand-ins until there is portrait art; the desktop app uses the same icons). */
const EMBLEM: Record<BardId, IconName> = {
  tavern: 'guitar',
  dry: 'feather',
  drunken: 'wine',
  sarcastic: 'drama',
  bored: 'landmark',
};

export function BardBadge({ id, size = 40 }: { id: BardId; size?: number }) {
  return (
    <span className="phone-bard-badge" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name={EMBLEM[id]} size={Math.round(size * 0.5)} />
    </span>
  );
}
