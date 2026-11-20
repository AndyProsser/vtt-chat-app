import type { BardId } from '@vtt-chat-app/shared';

import dry from '../../assets/bards/dry-portrait.svg';
import bored from '../../assets/bards/bored-portrait.svg';
import drunken from '../../assets/bards/drunken-portrait.svg';
import sarcastic from '../../assets/bards/sarcastic-portrait.svg';
import tavern from '../../assets/bards/tavern-portrait.svg';

/** The storyteller portraits (starter artwork; see `src/assets/bards/README.md`). */
const PORTRAIT: Record<BardId, string> = { tavern, dry, drunken, sarcastic, bored };

export function BardAvatar({ id, size = 40 }: { id: BardId; size?: number }) {
  return (
    <img
      className="vtt-bard-avatar"
      src={PORTRAIT[id]}
      alt=""
      width={size}
      height={size}
      draggable={false}
    />
  );
}
