import { HoverCard, Text } from '@radix-ui/themes';
import { MicOff } from 'lucide-react';
import { memo } from 'react';

import { useIsSpeaking } from '../hooks/useIsSpeaking.js';
import { avatarColor } from '../lib/avatarColor.js';
import { initials, memberAvatar, memberCard } from '../lib/rail.js';
import type { Member } from '../types/index.js';
import { linkQuality } from '../lib/linkQuality.js';
import { useStatsStore } from '../lib/statsStore.js';
import { Portrait } from './Portrait.js';

/**
 * One person on the rail. Memoised; it reads only its own speaking flag (LiveKit identity is the
 * account id), so one person speaking re-renders one avatar (STATE-AND-RESILIENCE.md).
 */
export const RailAvatar = memo(function RailAvatar({
  member,
  partyId,
  groupName,
}: {
  member: Member;
  partyId: string | undefined;
  groupName: string | undefined;
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
          <Portrait avatarUrl={memberAvatar(member)} fallback={initials(card.title)} />
          {muted && (
            <span className="vtt-av-mute" role="img" aria-label="Muted" title="Muted">
              <MicOff size={11} aria-hidden />
            </span>
          )}
          {partyId && (
            <span className="vtt-av-pip" style={{ background: avatarColor(partyId) }} aria-hidden />
          )}
        </span>
      </HoverCard.Trigger>
      <HoverCard.Content size="1" side="right" maxWidth="220px" className="vtt-hover-card">
        <Text as="div" weight="bold" size="2" className="vtt-head">
          {card.title}
        </Text>
        {card.lines.map((line) => (
          <Text as="div" size="1" key={line}>
            {line}
          </Text>
        ))}
        {groupName && (
          <>
            <hr className="vtt-card-sep" />
            <Text as="div" size="1" className="vtt-head">
              {groupName}
            </Text>
          </>
        )}
        <StatusDot member={member} />
      </HoverCard.Content>
    </HoverCard.Root>
  );
});

/**
 * Top-right of the hover card: grey when offline, an outlined dot when online but not in voice, and
 * otherwise the call quality (green, amber, red; green until the DM's link report arrives). One
 * primitive selector, so only a change of quality re-renders it.
 */
function StatusDot({ member }: { member: Member }) {
  const quality = useStatsStore((s) => linkQuality(s.byUser.get(member.userId)));
  const state = !member.online ? 'offline' : !member.inVoice ? 'online' : quality;
  const label = {
    offline: 'Offline',
    online: 'Online, not in voice',
    good: 'In voice, good connection',
    fair: 'In voice, fair connection',
    poor: 'In voice, poor connection',
    unknown: 'In voice',
  }[state];
  return (
    <i
      className={`vtt-card-dot vtt-card-dot-${state}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
