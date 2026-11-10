import { FileText } from 'lucide-react';

import { ItemIcon } from './ItemIcon.js';
import { cardLabel } from '../lib/timeline.js';
import { handoutViewOpen, panelOpen } from '../lib/tauriBridge.js';
import type { Member, TableCard } from '../types/index.js';

/** A loot or handout notice inline in chat; the "taken by" line is the grabbed indicator. */
export function ChatCard({ card, members }: { card: TableCard; members: Member[] }) {
  const taken = card.kind === 'loot' && Boolean(card.claimedBy);
  return (
    <button
      type="button"
      className={taken ? 'vtt-card vtt-card-taken' : 'vtt-card'}
      onClick={() =>
        void (card.kind === 'loot'
          ? panelOpen('inventory')
          : handoutViewOpen(card.id.replace(/^handout:/, '')))
      }
    >
      {card.kind === 'loot' ? (
        <ItemIcon
          type={card.itemType ?? (card.coin ? 'coin' : 'other')}
          rarity={card.rarity ?? null}
        />
      ) : (
        <FileText size={16} />
      )}
      <span>{cardLabel(card, members)}</span>
    </button>
  );
}
