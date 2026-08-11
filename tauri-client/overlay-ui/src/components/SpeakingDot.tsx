import { memo } from 'react';

import { useIsSpeaking } from '../hooks/useIsSpeaking.js';

/**
 * Leaf-isolated per docs/architecture/STATE-AND-RESILIENCE.md#leaf-isolation. Takes only
 * `participantId` — never a composed participant object — so a participant re-renders only
 * when their own speaking state flips.
 */
export const SpeakingDot = memo(function SpeakingDot({ participantId }: { participantId: string }) {
  const speaking = useIsSpeaking(participantId);
  return (
    <span className={speaking ? 'vtt-speaking-dot vtt-speaking-dot-active' : 'vtt-speaking-dot'} />
  );
});
