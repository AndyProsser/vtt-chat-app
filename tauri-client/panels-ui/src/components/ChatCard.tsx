import { ChevronDown, FileText, Image as ImageIcon, ImageOff, Paperclip } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { FlipPanel } from './FlipPanel.js';
import { ItemIcon } from './ItemIcon.js';
import { LootActions } from './LootActions.js';
import { handoutPicture } from '../lib/handoutPicture.js';
import { plainPreview } from '../lib/handoutTools.js';
import { cardLabel } from '../lib/timeline.js';
import { lootActions } from '../lib/lootActions.js';
import { isDm } from '../lib/tableModel.js';
import { handoutViewOpen } from '../lib/tauriBridge.js';
import type { Member, TableCard } from '../types/index.js';

const handoutId = (card: TableCard) => card.id.replace(/^handout:/, '');

/** One picture of a handout, loaded when it first shows. */
function CardPicture({ card, index }: { card: TableCard; index: number }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSrc(undefined);
    handoutPicture(handoutId(card), index).then(
      (s) => !cancelled && setSrc(s),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [card, index]);
  if (failed)
    return (
      <span className="vtt-card-picture-empty">
        <ImageOff size={18} aria-hidden /> The picture could not be loaded
      </span>
    );
  return src ? (
    <img className="vtt-card-picture-img" src={src} alt={`${card.title}, picture ${index + 1}`} />
  ) : (
    <span className="vtt-card-picture-empty vtt-muted">Loading…</span>
  );
}

/** The title and the first lines of the text (a note's start, or a caption). */
function CardText({ card, icon }: { card: TableCard; icon: ReactNode }) {
  const preview = card.excerpt ? plainPreview(card.excerpt) : '';
  return (
    <span className="vtt-card-body">
      <span className="vtt-card-title">
        {icon}
        <b>{card.title}</b>
      </span>
      {preview && <span className="vtt-card-excerpt">{preview}</span>}
    </span>
  );
}

/**
 * A handout in chat. A note shows its title and first three lines; a PDF is the same with a paperclip; a
 * set of pictures shows the title and caption above a larger picture, with flip buttons when there are
 * several. Clicking opens it large in its own window (zoom for pictures, pages for a PDF).
 */
function HandoutCard({ card }: { card: TableCard }) {
  const [index, setIndex] = useState(0);
  const open = () => void handoutViewOpen(handoutId(card));
  const label = `Open the handout: ${card.title}`;
  if (card.handoutKind === 'image' || card.handoutKind === 'map') {
    return (
      <article className="vtt-card vtt-card-handout vtt-card-set">
        <button type="button" className="vtt-card-open" aria-label={label} onClick={open}>
          <CardText card={card} icon={<ImageIcon size={14} aria-hidden />} />
        </button>
        <FlipPanel count={card.fileCount ?? 1} index={index} onIndex={setIndex}>
          <button type="button" className="vtt-card-picture" aria-label={label} onClick={open}>
            <CardPicture card={card} index={index} />
          </button>
        </FlipPanel>
      </article>
    );
  }
  return (
    <button type="button" className="vtt-card vtt-card-handout" aria-label={label} onClick={open}>
      <CardText
        card={card}
        icon={
          card.handoutKind === 'pdf' ? (
            <Paperclip size={14} aria-hidden />
          ) : (
            <FileText size={14} aria-hidden />
          )
        }
      />
    </button>
  );
}

/**
 * A loot item in chat: one line saying what it is and who has it. Opening it (when there is more to
 * see or do) shows the description and the buttons that fit you: take or store, store or return what you
 * took, and for the DM, give it to a named player.
 */
function LootCard({
  card,
  members,
  selfId,
}: {
  card: TableCard;
  members: Member[];
  selfId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const dm = isDm(members, selfId);
  const players = members.filter((m) => m.role === 'player');
  const actions = lootActions(card, selfId, dm);
  const expandable = Boolean(card.description) || actions.length > 0;
  const head = (
    <>
      <ItemIcon
        type={card.itemType ?? (card.coin ? 'coin' : 'other')}
        rarity={card.rarity ?? null}
      />
      <span>{cardLabel(card, members)}</span>
      {expandable && (
        <ChevronDown
          size={14}
          aria-hidden
          className={open ? 'vtt-card-chevron vtt-card-chevron-open' : 'vtt-card-chevron'}
        />
      )}
    </>
  );
  const taken = Boolean(card.claimedBy);
  return (
    <article className={taken ? 'vtt-card vtt-card-loot vtt-card-taken' : 'vtt-card vtt-card-loot'}>
      {expandable ? (
        <button
          type="button"
          className="vtt-card-open vtt-card-loot-head"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {head}
        </button>
      ) : (
        <div className="vtt-card-loot-head">{head}</div>
      )}
      {open && (
        <div className="vtt-card-loot-more">
          {card.description && <p className="vtt-viewer-caption">{card.description}</p>}
          <LootActions
            item={{
              id: card.id.replace(/^loot:/, ''),
              claimedBy: card.claimedBy,
              claimedFor: card.claimedFor,
            }}
            selfId={selfId}
            dm={dm}
            players={players}
          />
        </div>
      )}
    </article>
  );
}

/** A loot or handout notice inline in chat; the "taken by" line is the grabbed indicator. */
export function ChatCard({
  card,
  members,
  selfId,
}: {
  card: TableCard;
  members: Member[];
  selfId: string | null;
}) {
  if (card.kind === 'handout') return <HandoutCard card={card} />;
  return <LootCard card={card} members={members} selfId={selfId} />;
}
