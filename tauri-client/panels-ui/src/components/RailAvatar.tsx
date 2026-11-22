import { HoverCard, Text } from '@radix-ui/themes';
import { Lock, MicOff } from 'lucide-react';
import { memo, useState } from 'react';

import { useIsSpeaking } from '../hooks/useIsSpeaking.js';
import { avatarColor } from '../lib/avatarColor.js';
import {
  initials,
  memberAvatar,
  memberCard,
  railAvatarLabel,
  railState,
  RAIL_ICON_PX,
} from '../lib/rail.js';
import type { Member } from '../types/index.js';
import { CharacterDetail } from './CharacterDetail.js';
import { Portrait } from './Portrait.js';
import { SheetChips } from './SheetChips.js';

/**
 * One person on the rail. Memoised; it reads only its own speaking flag (LiveKit identity is the
 * account id), so one person speaking re-renders one avatar (STATE-AND-RESILIENCE.md).
 */
export const RailAvatar = memo(function RailAvatar({
  member,
  partyId,
  groupName,
  aside,
}: {
  member: Member;
  partyId: string | undefined;
  groupName: string | undefined;
  /** In the DM's private talk right now (the DM or the player). */
  aside?: boolean;
}) {
  const speaking = useIsSpeaking(member.userId);
  const card = memberCard(member);
  const classes = [
    'vtt-av',
    member.role === 'dm' ? 'vtt-av-dm' : '',
    speaking ? 'vtt-av-speaking' : '',
    railState(member) === 'disconnected' ? 'vtt-av-offline' : '',
    railState(member) === 'offline' ? 'vtt-av-idle' : '',
    aside ? 'vtt-av-aside' : '',
  ].join(' ');
  const muted = member.online && member.inVoice && member.muted;
  const sheet = member.character?.sheet ?? null;
  const [detail, setDetail] = useState(false);
  return (
    <>
      <HoverCard.Root openDelay={250}>
        <HoverCard.Trigger>
          <span className={classes} aria-label={railAvatarLabel(member)} role="img">
            <Portrait
              avatarUrl={memberAvatar(member)}
              fallback={initials(card.title)}
              size={RAIL_ICON_PX}
            />
            {member.role === 'dm' && (
              <span className="vtt-av-dmtag" aria-hidden>
                DM
              </span>
            )}
            {muted && (
              <span className="vtt-av-mute" role="img" aria-label="Muted" title="Muted">
                <MicOff size={12} aria-hidden />
              </span>
            )}
            {aside && (
              <span
                className="vtt-av-lock"
                role="img"
                aria-label="In a private talk"
                title="In a private talk"
              >
                <Lock size={10} aria-hidden />
              </span>
            )}
            {partyId && (
              <span
                className="vtt-av-pip"
                style={{ background: avatarColor(partyId) }}
                aria-hidden
              />
            )}
          </span>
        </HoverCard.Trigger>
        <HoverCard.Content
          size="1"
          side="right"
          maxWidth="220px"
          className={sheet ? 'vtt-hover-card vtt-hover-card-click' : 'vtt-hover-card'}
          {...(sheet
            ? { onClick: () => setDetail(true), title: 'Click for the full character details' }
            : {})}
        >
          <Text as="div" weight="bold" size="2" className="vtt-head">
            {card.title}
          </Text>
          {card.lines.map((line) => (
            <Text as="div" size="1" key={line}>
              {line}
            </Text>
          ))}
          <SheetChips sheet={sheet} />
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
      {sheet && (
        <CharacterDetail member={member} sheet={sheet} open={detail} onOpenChange={setDetail} />
      )}
    </>
  );
});

/** Top-right of the hover card: how this person is showing right now (not their call quality). */
function StatusDot({ member }: { member: Member }) {
  const state = railState(member);
  const label = {
    disconnected: 'Disconnected (app closed or signed out)',
    offline: member.via === 'web' ? 'On the web (chat only)' : 'Offline (chat only)',
    away: 'Away',
    online: 'Online, not in voice',
    voice: 'Online, in voice',
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
