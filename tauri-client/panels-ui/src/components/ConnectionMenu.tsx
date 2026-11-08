import { Popover } from '@radix-ui/themes';
import { Activity } from 'lucide-react';

import { describeLink, linkQuality } from '../lib/linkQuality.js';
import { useStatsStore } from '../lib/statsStore.js';
import { useTableStore } from '../lib/tableStore.js';
import { ToolButton } from './ToolButton.js';

/** DM-only: how each player's voice link is doing (latency, jitter, loss), refreshed every ~5 s. */
export function ConnectionMenu() {
  const members = useTableStore((s) => s.members);
  const byUser = useStatsStore((s) => s.byUser);
  const players = members.filter((m) => m.role === 'player');
  return (
    <Popover.Root>
      <Popover.Trigger>
        <ToolButton label="Connection quality of each player">
          <Activity size={15} />
        </ToolButton>
      </Popover.Trigger>
      <Popover.Content size="1" width="320px" align="end">
        <div className="vtt-groups">
          {players.length === 0 && <span className="vtt-muted">No players yet.</span>}
          {players.map((m) => {
            const stats = m.inVoice ? byUser.get(m.userId) : undefined;
            const quality = linkQuality(stats);
            return (
              <div key={m.userId} className="vtt-groups-row">
                <span>
                  <i className={`vtt-dot vtt-dot-${quality}`} aria-label={quality} />{' '}
                  {m.character?.name ?? m.displayName}
                </span>
                <span className="vtt-muted">
                  {!m.online ? 'offline' : !m.inVoice ? 'not in voice' : describeLink(stats)}
                </span>
              </div>
            );
          })}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
