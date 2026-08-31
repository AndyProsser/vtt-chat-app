import { ExpandToggle } from './ExpandToggle.js';
import { Avatar } from './Avatar.js';
import { MuteIcon } from './MuteIcon.js';
import { useParticipantIdentities } from '../hooks/useParticipantIdentities.js';

/**
 * The one default view everywhere — replaces Stage 3a's page-based `FullPanel`/`MicPill`
 * split entirely. See the compact-view redesign spec's "Compact View" section.
 */
export function CompactPanel() {
  const participantIdentities = useParticipantIdentities();

  return (
    <div className="vtt-compact-panel">
      <MuteIcon />
      <span className="vtt-divider" aria-hidden="true" />
      <div className="vtt-avatar-row">
        {participantIdentities.map((identity) => (
          <Avatar key={identity} participantId={identity} />
        ))}
      </div>
      <ExpandToggle />
    </div>
  );
}
