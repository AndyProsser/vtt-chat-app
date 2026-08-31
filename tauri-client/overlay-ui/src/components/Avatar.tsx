import { memo } from 'react';

import { useIsSpeaking } from '../hooks/useIsSpeaking.js';
import { avatarColor } from '../lib/avatarColor.js';

/**
 * Leaf-isolated per docs/architecture/STATE-AND-RESILIENCE.md — takes only `participantId`,
 * never a composed participant object, so one participant's speaking state flipping only
 * re-renders their own avatar. Placeholder content only: a color hashed from the identity
 * string, since there's no display name or portrait until Stage 3b's DDB extraction lands.
 */
export const Avatar = memo(function Avatar({ participantId }: { participantId: string }) {
  const speaking = useIsSpeaking(participantId);
  return (
    <span
      className={speaking ? 'vtt-avatar vtt-avatar-speaking' : 'vtt-avatar'}
      style={{ backgroundColor: avatarColor(participantId) }}
      title={participantId}
    />
  );
});
