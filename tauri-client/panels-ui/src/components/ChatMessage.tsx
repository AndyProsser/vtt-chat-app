import { memo } from 'react';

import { lineKind } from '../lib/commands.js';
import { Portrait } from './Portrait.js';
import { initials, memberAvatar } from '../lib/rail.js';
import type { ChatLine, Member } from '../types/index.js';

interface Props {
  line: ChatLine;
  members: Member[];
  selfId: string | null;
}

/** One chat line: avatar, name, text. Whispers and DM-private lines are coloured and also labelled. */
export const ChatMessage = memo(function ChatMessage({ line, members, selfId }: Props) {
  const kind = lineKind(line, members);
  const sender = members.find((m) => m.userId === line.from.userId);
  const mine = line.from.userId === selfId;
  const name = mine ? 'You' : line.from.name;
  const emote = line.text.startsWith('* ');
  const label =
    kind === 'public'
      ? null
      : kind === 'dm-private'
        ? line.to?.userId === selfId
          ? 'DM → you only'
          : `DM → ${line.to?.name ?? ''}`
        : line.to?.userId === selfId
          ? 'whispers to you'
          : `whisper → ${line.to?.name ?? ''}`;
  return (
    <div className="vtt-msg">
      <span className={sender?.role === 'dm' ? 'vtt-av vtt-av-sm vtt-av-dm' : 'vtt-av vtt-av-sm'}>
        <Portrait
          avatarUrl={sender ? memberAvatar(sender) : undefined}
          fallback={initials(line.from.name)}
          size={13}
        />
      </span>
      <div className={`vtt-bubble vtt-bubble-${kind}`}>
        <div className="vtt-msg-meta">
          <b>{name}</b>
          {label && <span className="vtt-msg-label">{label}</span>}
        </div>
        <div className={emote ? 'vtt-emote' : undefined}>
          {emote ? line.text.slice(2) : line.text}
        </div>
      </div>
    </div>
  );
});
