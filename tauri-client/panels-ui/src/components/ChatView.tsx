import { useEffect, useMemo, useRef } from 'react';

import { timeline } from '../lib/timeline.js';
import { useTableStore } from '../lib/tableStore.js';
import { ChatCard } from './ChatCard.js';
import { ChatMessage } from './ChatMessage.js';

/** The conversation; fills the space between the top bar and the composer, scrolling inside itself. */
export function ChatView({ selfId }: { selfId: string | null }) {
  const chat = useTableStore((s) => s.chat);
  const cards = useTableStore((s) => s.cards);
  const notices = useTableStore((s) => s.notices);
  const members = useTableStore((s) => s.members);
  const entries = useMemo(() => timeline(chat, cards, notices), [chat, cards, notices]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [entries.length]);
  return (
    <>
      <section className="vtt-chat" aria-label="Chat" aria-live="polite">
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
