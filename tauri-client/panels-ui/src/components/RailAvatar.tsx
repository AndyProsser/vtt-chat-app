import { Flex, HoverCard, Slider, Text } from '@radix-ui/themes';
import { MicOff } from 'lucide-react';
import { memo, useState } from 'react';

import { useAudioEngine } from '../hooks/useAudioEngine.js';
import { playerVolumeSet } from '../lib/tauriBridge.js';
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
import { Portrait } from './Portrait.js';

/**
 * One person on the rail. Memoised; it reads only its own speaking flag (LiveKit identity is the
 * account id), so one person speaking re-renders one avatar (STATE-AND-RESILIENCE.md).
 */
export const RailAvatar = memo(function RailAvatar({
  member,
  partyId,
  groupName,
  selfId,
}: {
  member: Member;
  /** The signed-in player, whose own volume is not adjustable. */
  selfId?: string | null;
  partyId: string | undefined;
  groupName: string | undefined;
}) {
  const speaking = useIsSpeaking(member.userId);
  const card = memberCard(member);
  const classes = [
    'vtt-av',
    member.role === 'dm' ? 'vtt-av-dm' : '',
    speaking ? 'vtt-av-speaking' : '',
    railState(member) === 'disconnected' ? 'vtt-av-offline' : '',
    railState(member) === 'offline' ? 'vtt-av-idle' : '',
  ].join(' ');
  const muted = member.online && member.inVoice && member.muted;
  return (
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
        <PlayerVolume userId={member.userId} selfId={selfId ?? null} />
      </HoverCard.Content>
    </HoverCard.Root>
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

/**
 * This person's volume for you (new audio engine only; hidden otherwise, and for yourself). It is saved
 * by account, so it follows them across sessions.
 */
function PlayerVolume({ userId, selfId }: { userId: string; selfId: string | null }) {
  const engine = useAudioEngine();
  const [value, setValue] = useState<number>();
  if (engine?.active !== 'mixer' || userId === selfId) return null;
  const shown = value ?? engine.volumes[userId] ?? 1;
  return (
    <Flex direction="column" gap="1" mt="2">
      <Text size="1">Volume {Math.round(shown * 100)}%</Text>
      <Slider
        aria-label="This person's volume"
        size="1"
        min={0}
        max={2}
        step={0.05}
        value={[shown]}
        onValueChange={([v]) => setValue(v ?? 1)}
        onValueCommit={([v]) => void playerVolumeSet(userId, v ?? 1).catch(console.error)}
      />
    </Flex>
  );
}
