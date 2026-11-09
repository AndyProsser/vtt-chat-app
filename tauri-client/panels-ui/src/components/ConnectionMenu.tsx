import { Popover } from '@radix-ui/themes';
import { Activity, ChartLine, Hash } from 'lucide-react';
import { useState } from 'react';

import { describeLink, linkQuality } from '../lib/linkQuality.js';
import { useStatsStore } from '../lib/statsStore.js';
import { useTableStore } from '../lib/tableStore.js';
import { Sparkline } from './Sparkline.js';
import { ToolButton } from './ToolButton.js';

const VIEW_KEY = 'vtt.linkView';
type View = 'graph' | 'numbers';

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'numbers' ? 'numbers' : 'graph';
  } catch {
    return 'graph';
  }
}

/** DM-only: how each player's voice link is doing (latency, jitter, loss), refreshed every ~5 s. */
export function ConnectionMenu() {
  const members = useTableStore((s) => s.members);
  const byUser = useStatsStore((s) => s.byUser);
  const players = members.filter((m) => m.role === 'player');
  const [view, setView] = useState<View>(savedView);
  function choose(next: View) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* a remembered view is a convenience */
    }
  }
  return (
    <Popover.Root>
      <Popover.Trigger>
        <ToolButton label="Connection quality of each player">
          <Activity size={15} />
        </ToolButton>
      </Popover.Trigger>
      <Popover.Content size="1" width="320px" align="end">
        <div className="vtt-groups">
          <div className="vtt-groups-row">
            <span className="vtt-muted">Latency, last two minutes</span>
            <ToolButton
              label={view === 'graph' ? 'Show numbers' : 'Show graphs'}
              pressed={view === 'numbers'}
              onClick={() => choose(view === 'graph' ? 'numbers' : 'graph')}
            >
              {view === 'graph' ? <Hash size={14} /> : <ChartLine size={14} />}
            </ToolButton>
          </div>
          {players.length === 0 && <span className="vtt-muted">No players yet.</span>}
          {players.map((m) => {
            const stats = m.inVoice ? byUser.get(m.userId) : undefined;
            const quality = linkQuality(stats);
            const state = !m.online ? 'offline' : !m.inVoice ? 'not in voice' : undefined;
            return (
              <div key={m.userId} className="vtt-groups-row" title={describeLink(stats)}>
                <span>
                  <i className={`vtt-dot vtt-dot-${quality}`} aria-label={quality} />{' '}
                  {m.character?.name ?? m.displayName}
                </span>
                {state ? (
                  <span className="vtt-muted">{state}</span>
                ) : view === 'graph' ? (
                  <span className="vtt-link-graph">
                    <Sparkline values={stats?.history ?? []} quality={quality} />
                    <span className="vtt-muted vtt-link-now">
                      {stats ? `${Math.round(stats.rttMs)} ms` : '—'}
                    </span>
                  </span>
                ) : (
                  <span className="vtt-muted">{describeLink(stats)}</span>
                )}
              </div>
            );
          })}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
