import { Button, Flex, Text } from '@radix-ui/themes';
import { useEffect, useMemo, useRef, useState } from 'react';

import { whisperPeer } from '../../lib/phone/chat.js';
import { lineTime } from '../../lib/phone/format.js';
import { chatHistory } from '../../lib/phone/phoneApi.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import type { ChatLine } from '../../types/phone.js';
import { Composer } from './Composer.js';

const PAGE = 50;

/** The table's chat, with your whispers in line. Newest at the bottom, like every chat. */
export function ChatTab({
  token,
  campaignId,
  say,
}: {
  token: string;
  campaignId: string;
  say: (text: string, to?: string) => boolean;
}) {
  const lines = usePhoneStore((s) => s.lines);
  const members = usePhoneStore((s) => s.members);
  const userId = usePhoneStore((s) => s.userId) ?? '';
  const live = usePhoneStore((s) => s.live);
  const [more, setMore] = useState<'idle' | 'loading' | 'done'>('idle');
  const bottom = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const names = useMemo(() => new Map(members.map((m) => [m.userId, m.displayName])), [members]);
  const now = Date.now();

  useEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ block: 'end' });
  }, [lines.length]);

  async function earlier() {
    const oldest = lines[0];
    if (!oldest) return;
    setMore('loading');
    try {
      const older = await chatHistory(token, campaignId, oldest.at);
      usePhoneStore.getState().addLines(older);
      setMore(older.length < 50 ? 'done' : 'idle');
    } catch {
      setMore('idle');
    }
  }

  return (
    <Flex direction="column" className="phone-chat">
      <div
        className="phone-chat-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {lines.length >= PAGE && more !== 'done' && (
          <Button
            variant="ghost"
            size="1"
            loading={more === 'loading'}
            onClick={() => void earlier()}
          >
            Earlier messages
          </Button>
        )}
        {lines.length === 0 && (
          <Text color="gray" align="center" mt="6">
            Nothing here yet. Say something to your table.
          </Text>
        )}
        {lines.map((line) => (
          <Line key={line.id} line={line} userId={userId} names={names} now={now} />
        ))}
        <div ref={bottom} />
      </div>
      {live !== 'live' && (
        <Text size="1" color="amber" className="phone-live-note" role="status">
          {live === 'connecting' ? 'Connecting…' : 'Offline. Reconnecting when you have a signal.'}
        </Text>
      )}
      <Composer members={members.filter((m) => m.userId !== userId)} say={say} />
    </Flex>
  );
}

function Line({
  line,
  userId,
  names,
  now,
}: {
  line: ChatLine;
  userId: string;
  names: Map<string, string>;
  now: number;
}) {
  const mine = line.fromId === userId;
  const peer = whisperPeer(line, userId);
  const whisper = line.toId !== null;
  return (
    <div
      className={`phone-line ${mine ? 'phone-line-mine' : ''} ${whisper ? 'phone-line-whisper' : ''}`}
    >
      <Flex gap="2" align="baseline" className="phone-line-head">
        <Text size="1" weight="medium">
          {mine ? 'You' : line.fromName}
        </Text>
        {whisper && (
          <Text size="1" color="violet">
            whisper to {mine ? (names.get(peer ?? '') ?? 'someone') : 'you'}
          </Text>
        )}
        <Text size="1" color="gray">
          {lineTime(line.at, now)}
        </Text>
      </Flex>
      <div className="phone-bubble">{line.text}</div>
    </div>
  );
}
