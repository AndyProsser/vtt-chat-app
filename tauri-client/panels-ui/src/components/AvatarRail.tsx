import { Merge, UsersRound } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { createPortal } from 'react-dom';

import { useGroupDrag } from '../hooks/useGroupDrag.js';
import { avatarColor } from '../lib/avatarColor.js';
import { groupNameOf, railSections } from '../lib/groups.js';
import { initials, memberAvatar } from '../lib/rail.js';
import { useTableStore } from '../lib/tableStore.js';
import { ConnectionMenu } from './ConnectionMenu.js';
import { Portrait } from './Portrait.js';
import { RailAvatar } from './RailAvatar.js';
import { ToolButton } from './ToolButton.js';

/**
 * Everyone at the table, stacked: the DM pinned on top, then the groups with a horizontal rule between
 * them. The DM drags a player onto another group, or onto the new-group target at the foot, and one
 * button there brings everyone back together. Players just see who is with whom.
 */
export function AvatarRail({ dm }: { dm: boolean }) {
  const members = useTableStore((s) => s.members);
  const view = useTableStore((s) => s.parties);
  const sections = useMemo(() => railSections(members, view), [members, view]);
  const host = members.find((m) => m.role === 'dm');
  const { drag, error, send, begin } = useGroupDrag();
  return (
    <nav className="vtt-rail" aria-label="People at the table">
      {host && (
        <div className="vtt-rail-item">
          <RailAvatar member={host} partyId={undefined} groupName={undefined} />
        </div>
      )}
      {sections.map((section, i) => (
        <Fragment key={section.id}>
          {(i > 0 || host) && <hr className="vtt-rail-sep" />}
          <div
            data-lane={dm ? section.id : undefined}
            className={
              drag?.over === section.id ? 'vtt-rail-lane vtt-rail-lane-over' : 'vtt-rail-lane'
            }
            aria-label={section.name}
          >
            {section.members.length === 0 && <span className="vtt-rail-empty" aria-hidden />}
            {section.members.map((m) => (
              <div
                key={m.userId}
                className={
                  drag?.member.userId === m.userId
                    ? 'vtt-rail-item vtt-rail-lifted'
                    : 'vtt-rail-item'
                }
                onPointerDown={dm ? (e) => begin(m, e) : undefined}
              >
                <RailAvatar
                  member={m}
                  partyId={section.id === 'main' ? undefined : section.id}
                  groupName={groupNameOf(view, m.userId)}
                />
              </div>
            ))}
          </div>
        </Fragment>
      ))}
      {dm && (
        <>
          <hr className="vtt-rail-sep" />
          <div className="vtt-rail-item">
            <div
              data-lane="new"
              className={drag?.over === 'new' ? 'vtt-rail-new vtt-rail-new-over' : 'vtt-rail-new'}
              title="Drag a player here to start a new group"
              aria-label="Start a new group: drag a player here"
            >
              <UsersRound size={16} aria-hidden />
            </div>
            {view.split && (
              <ToolButton
                label="Bring everyone back together"
                onClick={() => void send('party.reset', {})}
              >
                <Merge size={14} />
              </ToolButton>
            )}
            {error && (
              <span className="vtt-muted" role="alert">
                !
              </span>
            )}
          </div>
          <div className="vtt-rail-foot">
            <ConnectionMenu />
          </div>
        </>
      )}
      {drag &&
        createPortal(
          <div className="vtt-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden>
            <i className="vtt-chip-av" style={{ background: avatarColor(drag.member.userId) }}>
              <Portrait
                avatarUrl={memberAvatar(drag.member)}
                fallback={initials(drag.member.character?.name ?? drag.member.displayName)}
                size={12}
              />
            </i>
            <span>{drag.member.character?.name ?? drag.member.displayName}</span>
          </div>,
          document.body,
        )}
    </nav>
  );
}
