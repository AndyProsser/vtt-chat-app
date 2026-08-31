import { ExpandToggle } from './ExpandToggle.js';
import { Avatar } from './Avatar.js';
import { MuteIcon } from './MuteIcon.js';
import { useParticipantIdentities } from '../hooks/useParticipantIdentities.js';

/**
 * Opt-in vertical view — see the compact-view redesign spec's "Expanded (Full) View" section.
 * Flat for now (no group sections, no condition badges, no per-remote mute state): those need
 * Stage 4 (groups) and Plan C (conditions), neither built yet. This plan only replaces Stage
 * 3a's page-based full/pill split with per-instance expand/collapse of the same underlying
 * data — participant identity and speaking state.
 */
export function ExpandedPanel() {
  const participantIdentities = useParticipantIdentities();

  return (
    <div className="vtt-expanded-panel">
      <div className="vtt-expanded-header">
        <MuteIcon />
        <ExpandToggle />
      </div>
      {participantIdentities.length === 0 ? (
        <div className="vtt-participants-empty">No one else here yet</div>
      ) : (
        <ul className="vtt-expanded-list">
          {participantIdentities.map((identity) => (
            <li key={identity} className="vtt-expanded-row">
              <Avatar participantId={identity} />
              <span>{identity}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
