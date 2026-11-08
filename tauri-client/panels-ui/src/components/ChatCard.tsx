import { BackpackIcon, FileTextIcon } from '@radix-ui/react-icons';

import { cardLabel } from '../lib/timeline.js';
import { panelOpen } from '../lib/tauriBridge.js';
import type { Member, TableCard } from '../types/index.js';

/** A loot or handout notice inline in chat; the "taken by" line is the grabbed indicator. */
export function ChatCard({ card, members }: { card: TableCard; members: Member[] }) {
  const taken = card.kind === 'loot' && Boolean(card.claimedBy);
  return (
    <button
      type="button"
      className={taken ? 'vtt-card vtt-card-taken' : 'vtt-card'}
      onClick={() => void panelOpen(card.kind === 'loot' ? 'inventory' : 'handouts')}
    >
      {card.kind === 'loot' ? <BackpackIcon /> : <FileTextIcon />}
      <span>{cardLabel(card, members)}</span>
    </button>
  );
}
