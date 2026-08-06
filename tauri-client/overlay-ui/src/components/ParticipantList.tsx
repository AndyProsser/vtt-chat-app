import { memo } from 'react';

import { useParticipantIdentities } from '../hooks/useParticipantIdentities.js';

/** Leaf-isolated per docs/architecture/STATE-AND-RESILIENCE.md — subscribes to one field only. */
export const ParticipantList = memo(function ParticipantList() {
  const participantIdentities = useParticipantIdentities();

  if (participantIdentities.length === 0) {
    return <div className="vtt-participants-empty">No one else here yet</div>;
  }

  return (
    <ul className="vtt-participants">
      {participantIdentities.map((identity) => (
        <li key={identity}>{identity}</li>
      ))}
    </ul>
  );
});
