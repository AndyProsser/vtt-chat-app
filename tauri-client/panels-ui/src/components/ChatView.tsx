import { useEffect, useMemo, useRef } from 'react';

import { useOlderChat } from '../hooks/useOlderChat.js';
import { useRestoredCards } from '../hooks/useRestoredCards.js';
import { timeline } from '../lib/timeline.js';
import { useTableStore } from '../lib/tableStore.js';
import { ChatCard } from './ChatCard.js';
import { ChatMessage } from './ChatMessage.js';

/**
 * The conversation; fills the space between the top bar and the composer, scrolling inside itself.
 * Scrolling to the top loads older chat from the server, 50 lines at a time.
 */
export function ChatView({ selfId }: { selfId: string | null }) {
  const chat = useTableStore((s) => s.chat);
  const cards = useTableStore((s) => s.cards);
  const notices = useTableStore((s) => s.notices);
  const members = useTableStore((s) => s.members);
  const entries = useMemo(() => timeline(chat, cards, notices), [chat, cards, notices]);
  const scroller = useRef<HTMLElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const older = useOlderChat(scroller, top);
  useRestoredCards();
  // Follow the conversation when something new arrives at the bottom, not when older lines load above.
  const last = entries.at(-1);
  const lastKey = last
    ? `${last.type}:${last.type === 'line' ? last.line.id : last.type === 'notice' ? last.notice.id : last.card.id}`
    : '';
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lastKey]);
  return (
    <>
      <section ref={scroller} className="vtt-chat" aria-label="Chat" aria-live="polite">
        <div ref={top} className="vtt-chat-history" aria-live="off">
          {older.loading && <span className="vtt-muted">Loading older messages…</span>}
          {older.failed && (
            <button type="button" className="vtt-chat-history-retry" onClick={older.retry}>
              Couldn’t load older messages. Try again
            </button>
          )}
          {older.done && chat.length > 0 && (
            <span className="vtt-muted">Start of the conversation</span>
          )}
        </div>
        {entries.map((e) =>
          e.type === 'line' ? (
            <ChatMessage key={e.line.id} line={e.line} members={members} selfId={selfId} />
          ) : e.type === 'notice' ? (
            <p key={e.notice.id} className="vtt-notice" role="status">
              {e.notice.text}
            </p>
          ) : (
            <ChatCard key={e.card.id} card={e.card} members={members} selfId={selfId} />
          ),
        )}
        <div ref={end} />
      </section>
    </>
  );
}
