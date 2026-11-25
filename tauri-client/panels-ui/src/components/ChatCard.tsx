import { ChevronDown, FileText, Image as ImageIcon, ImageOff, Paperclip } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { FlipPanel } from './FlipPanel.js';
import { ItemIcon } from './ItemIcon.js';
import { SplitButton, SplitFieldset, useCoinSplit } from './CoinSplit.js';
import { LootActions } from './LootActions.js';
import { handoutPicture } from '../lib/handoutPicture.js';
import { plainPreview } from '../lib/handoutTools.js';
import { cardLabel } from '../lib/timeline.js';
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
 * A loot item in chat: one line saying what it is and who has it, with the buttons that fit you on the
 * same line (take or store, store or return, take or return from the party stash, and for the DM a Give
 * menu), left of the arrow. The arrow opens the description, when there is one.
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
  const split = useCoinSplit(players);
  const expandable = Boolean(card.description);
  const label = (
    <>
      <ItemIcon
        type={card.itemType ?? (card.coin ? 'coin' : 'other')}
        rarity={card.rarity ?? null}
      />
      <span>{cardLabel(card, members)}</span>
    </>
  );
  const taken = Boolean(card.claimedBy);
  return (
    <article className={taken ? 'vtt-card vtt-card-loot vtt-card-taken' : 'vtt-card vtt-card-loot'}>
      <div className="vtt-card-loot-head">
        {expandable ? (
          <button
            type="button"
            className="vtt-card-open vtt-card-loot-title"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {label}
          </button>
        ) : (
          <div className="vtt-card-loot-title">{label}</div>
        )}
        <LootActions
          item={{
            id: card.id.replace(/^loot:/, ''),
            claimedBy: card.claimedBy,
            claimedFor: card.claimedFor,
          }}
          selfId={selfId}
          dm={dm}
          players={players}
          inChat
        />
        {card.coin && !card.claimedBy && (
          <SplitButton onClick={() => split.start(card.id.replace(/^loot:/, ''))} />
        )}
        {expandable && (
          <button
            type="button"
            className="vtt-card-open vtt-card-chevron-button"
            aria-label={open ? 'Hide the description' : 'Show the description'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronDown
              size={14}
              aria-hidden
              className={open ? 'vtt-card-chevron vtt-card-chevron-open' : 'vtt-card-chevron'}
            />
          </button>
        )}
      </div>
      {split.itemId && (
        <SplitFieldset
          split={split}
          players={players}
          item={{ name: card.title, quantity: card.quantity ?? 0 }}
        />
      )}
      {open && card.description && (
        <div className="vtt-card-loot-more">
          <p className="vtt-viewer-caption">{card.description}</p>
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
