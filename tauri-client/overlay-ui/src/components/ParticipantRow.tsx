import { memo } from 'react';

import { SpeakingDot } from './SpeakingDot.js';

/**
 * Renders one participant's identity plus their `SpeakingDot`. Still a raw `ddbUserId` string
 * in 3a — 3b enriches this with a real character name once DDB extraction exists.
 */
export const ParticipantRow = memo(function ParticipantRow({ identity }: { identity: string }) {
  return (
    <li className="vtt-participant-row">
      <SpeakingDot participantId={identity} />
      <span>{identity}</span>
    </li>
  );
});
