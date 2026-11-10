import { FileText, ImageOff, Map as MapIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ItemIcon } from './ItemIcon.js';
import { handoutPicture } from '../lib/handoutPicture.js';
import { plainPreview } from '../lib/handoutTools.js';
import { cardLabel } from '../lib/timeline.js';
import { handoutViewOpen, panelOpen } from '../lib/tauriBridge.js';
import type { Member, TableCard } from '../types/index.js';

const handoutId = (card: TableCard) => card.id.replace(/^handout:/, '');

/** A small picture for a picture handout's card. */
function Thumbnail({ card }: { card: TableCard }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    handoutPicture(handoutId(card)).then(
      (s) => !cancelled && setSrc(s),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [card]);
  if (failed) return <ImageOff size={16} aria-label="The picture could not be loaded" />;
  return src ? (
    <img className="vtt-card-thumb" src={src} alt="" />
  ) : (
    <span className="vtt-card-thumb" />
  );
}

/**
 * A handout in chat: a note shows its title and the first three lines, a picture or map shows a small
 * thumbnail with its title as the caption. Clicking opens it large in its own window.
 */
function HandoutCard({ card }: { card: TableCard }) {
  const picture = card.handoutKind === 'image' || card.handoutKind === 'map';
  const preview = card.excerpt ? plainPreview(card.excerpt) : '';
  return (
    <button
      type="button"
      className="vtt-card vtt-card-handout"
      aria-label={`Open the handout: ${card.title}`}
      onClick={() => void handoutViewOpen(handoutId(card))}
    >
      {picture && <Thumbnail card={card} />}
      <span className="vtt-card-body">
        <span className="vtt-card-title">
          {card.handoutKind === 'map' ? (
            <MapIcon size={14} aria-hidden />
          ) : (
            <FileText size={14} aria-hidden />
          )}
          <b>{card.title}</b>
        </span>
        {preview && <span className="vtt-card-excerpt">{preview}</span>}
      </span>
    </button>
  );
}

/** A loot or handout notice inline in chat; the "taken by" line is the grabbed indicator. */
export function ChatCard({ card, members }: { card: TableCard; members: Member[] }) {
  if (card.kind === 'handout') return <HandoutCard card={card} />;
  const taken = Boolean(card.claimedBy);
  return (
    <button
      type="button"
      className={taken ? 'vtt-card vtt-card-taken' : 'vtt-card'}
      onClick={() => void panelOpen('inventory')}
    >
      <ItemIcon
        type={card.itemType ?? (card.coin ? 'coin' : 'other')}
        rarity={card.rarity ?? null}
      />
      <span>{cardLabel(card, members)}</span>
    </button>
  );
}
