import { useEffect, useRef } from 'react';

import { useTableStore } from '../lib/tableStore.js';
import { ChatMessage } from './ChatMessage.js';

/** The conversation; fills the space between the top bar and the composer, scrolling inside itself. */
export function ChatView({ selfId }: { selfId: string | null }) {
  const chat = useTableStore((s) => s.chat);
  const members = useTableStore((s) => s.members);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [chat.length]);
  return (
    <section className="vtt-chat" aria-label="Chat" aria-live="polite">
      {chat.map((line) => (
        <ChatMessage key={line.id} line={line} members={members} selfId={selfId} />
      ))}
      <div ref={end} />
    </section>
  );
}
