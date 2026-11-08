import { useMemo } from 'react';

import { railOrder } from '../lib/rail.js';
import { useTableStore } from '../lib/tableStore.js';
import { ConnectionMenu } from './ConnectionMenu.js';
import { RailAvatar } from './RailAvatar.js';

/** Everyone at the table, stacked: the DM pinned on top, a divider, then the players. */
export function AvatarRail({ dm }: { dm: boolean }) {
  const members = useTableStore((s) => s.members);
  const assignments = useTableStore((s) => s.parties.assignments);
  const ordered = useMemo(() => railOrder(members), [members]);
  return (
    <nav className="vtt-rail" aria-label="People at the table">
      {ordered.map((m, i) => (
        <div key={m.userId} className="vtt-rail-item">
          {i === 1 && ordered[0]?.role === 'dm' && <hr className="vtt-rail-sep" />}
          <RailAvatar member={m} partyId={assignments[m.userId]} />
        </div>
      ))}
      {dm && (
        <div className="vtt-rail-foot">
          <ConnectionMenu />
        </div>
      )}
    </nav>
  );
}
