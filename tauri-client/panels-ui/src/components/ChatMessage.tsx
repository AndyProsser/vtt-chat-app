import { memo } from 'react';

import { languageOf, languageStyle } from '../lib/chatStyle.js';
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
  const fromDm = sender?.role === 'dm';
  const name = mine ? 'You' : line.from.name;
  const emote = line.text.startsWith('* ');
  // A whisper keeps its own look whatever its kind; only public lines are styled by kind.
  const style = kind === 'public' ? line.kind : 'chat';
  const language = style === 'say' ? languageOf(line.lang) : undefined;
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
    <div className={mine ? 'vtt-msg vtt-msg-mine' : 'vtt-msg'}>
      <span className={sender?.role === 'dm' ? 'vtt-av vtt-av-sm vtt-av-dm' : 'vtt-av vtt-av-sm'}>
        <Portrait
          avatarUrl={sender ? memberAvatar(sender) : undefined}
          fallback={initials(line.from.name)}
          size={13}
        />
      </span>
      <div
        className={`vtt-bubble vtt-bubble-${kind}${style === 'chat' ? '' : ` vtt-kind-${style}`}${fromDm && kind === 'public' ? ' vtt-bubble-from-dm' : ''}${mine ? ' vtt-bubble-mine' : ''}`}
      >
        {style === 'do' ? (
          <div className="vtt-do-text">
            * {line.from.name} {line.text}
          </div>
        ) : (
          <>
            <div className="vtt-msg-meta">
              <b>{name}</b>
              {fromDm && !mine && <span className="vtt-dm-tag">DM</span>}
              {label && <span className="vtt-msg-label">{label}</span>}
              {style === 'ooc' && (
                <span className="vtt-ooc-tag" role="img" aria-label="out of character">
                  OOC
                </span>
              )}
            </div>
            {style === 'say' ? (
              <div className="vtt-say-text" style={languageStyle(line.lang)}>
                {'\u201c'}
                {line.text}
                {'\u201d'}
              </div>
            ) : (
              <div className={emote ? 'vtt-emote' : undefined}>
                {emote ? line.text.slice(2) : line.text}
              </div>
            )}
            {language && <div className="vtt-lang-caption">in {language.name}</div>}
          </>
        )}
      </div>
    </div>
  );
});
