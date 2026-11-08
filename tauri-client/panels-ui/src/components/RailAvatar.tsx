import { HoverCard, Text } from '@radix-ui/themes';
import { memo } from 'react';

import { useIsSpeaking } from '../hooks/useIsSpeaking.js';
import { avatarColor } from '../lib/avatarColor.js';
import { initials, memberCard } from '../lib/rail.js';
import type { Member } from '../types/index.js';
import { Portrait } from './Portrait.js';

/**
 * One person on the rail. Memoised; it reads only its own speaking flag (LiveKit identity is the
 * account id), so one person speaking re-renders one avatar (STATE-AND-RESILIENCE.md).
 */
export const RailAvatar = memo(function RailAvatar({
  member,
  partyId,
}: {
  member: Member;
  partyId: string | undefined;
}) {
  const speaking = useIsSpeaking(member.userId);
  const card = memberCard(member);
  const classes = [
    'vtt-av',
    member.role === 'dm' ? 'vtt-av-dm' : '',
    speaking ? 'vtt-av-speaking' : '',
    member.online ? '' : 'vtt-av-offline',
  ].join(' ');
  const muted = member.online && member.inVoice && member.muted;
  return (
    <HoverCard.Root openDelay={250}>
      <HoverCard.Trigger>
        <span className={classes} aria-label={card.title} role="img">
          <Portrait avatarUrl={member.character?.avatarUrl} fallback={initials(card.title)} />
          {muted && <span className="vtt-av-badge" aria-label="muted" />}
          {partyId && (
            <span className="vtt-av-pip" style={{ background: avatarColor(partyId) }} aria-hidden />
          )}
        </span>
      </HoverCard.Trigger>
      <HoverCard.Content size="1" side="right" maxWidth="220px">
        <Text as="div" weight="bold" size="2" className="vtt-head">
          {card.title}
        </Text>
        {card.lines.map((line) => (
          <Text as="div" size="1" key={line}>
            {line}
          </Text>
        ))}
        <Text as="div" size="1" color="gray">
          {member.online ? (member.inVoice ? 'In voice' : 'Online') : 'Offline'}
        </Text>
      </HoverCard.Content>
    </HoverCard.Root>
  );
});
