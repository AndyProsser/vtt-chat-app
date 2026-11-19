import { ChartLine, Hash, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Slider } from '@radix-ui/themes';

import { PLAYER_VOLUME_MAX } from '../consts/volume.js';
import { useAccount } from '../hooks/useAccount.js';
import { useAudioEngine } from '../hooks/useAudioEngine.js';
import { describeLink, linkQuality } from '../lib/linkQuality.js';
import { playerLines } from '../lib/players.js';
import { useStatsStore } from '../lib/statsStore.js';
import { playerVolumeSet } from '../lib/tauriBridge.js';
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

/**
 * Settings → Players, for everyone: how loud you hear each person (saved by account on this machine, so a quiet
 * microphone is fixed once and stays fixed; needs the app's own audio engine). The DM also sees each player's
 * link (latency, jitter, loss, refreshed every ~5 s) on the same row.
 */
export function PlayersPanel({ dm }: { dm: boolean }) {
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const byUser = useStatsStore((s) => s.byUser);
  const engine = useAudioEngine();
  const mixer = engine?.active === 'mixer';
  const [values, setValues] = useState<Record<string, number>>({});
  const [view, setView] = useState<View>(savedView);
  const others = members.filter((m) => m.userId !== status?.userId);
  function choose(next: View) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* a remembered view is a convenience */
    }
  }
  function setVolume(userId: string, v: number) {
    setValues((s) => ({ ...s, [userId]: v }));
    void playerVolumeSet(userId, v).catch(console.error);
  }
  return (
    <div className="vtt-groups">
      <div className="vtt-groups-row">
        <span className="vtt-muted">
          {mixer
            ? 'How loud you hear each person. Only on this machine.'
            : 'Volume per person needs the app’s own audio engine (Settings → Audio).'}
        </span>
        {dm && (
          <ToolButton
            label={view === 'graph' ? 'Show numbers' : 'Show graphs'}
            pressed={view === 'numbers'}
            onClick={() => choose(view === 'graph' ? 'numbers' : 'graph')}
          >
            {view === 'graph' ? <Hash size={14} /> : <ChartLine size={14} />}
          </ToolButton>
        )}
      </div>
      {others.length === 0 && <span className="vtt-muted">Nobody else is here.</span>}
      {others.map((m) => {
        const { primary } = playerLines(m);
        const shown = values[m.userId] ?? engine?.volumes[m.userId] ?? 1;
        const stats = m.inVoice ? byUser.get(m.userId) : undefined;
        const quality = linkQuality(stats);
        const state = !m.online ? 'offline' : !m.inVoice ? 'not in voice' : undefined;
        const showLink = dm && m.role === 'player';
        return (
          <div key={m.userId} className="vtt-player-row">
            <div className="vtt-groups-row" title={showLink ? describeLink(stats) : undefined}>
              <span className="vtt-link-name">
                {showLink && <i className={`vtt-dot vtt-dot-${quality}`} aria-label={quality} />}{' '}
                {primary}
              </span>
              {showLink &&
                (state ? (
                  <span className="vtt-muted">{state}</span>
                ) : view === 'graph' ? (
                  <span className="vtt-link-graph">
                    <Sparkline
                      values={stats?.history ?? []}
                      qualities={stats?.qualities ?? []}
                      quality={quality}
                    />
                    <span className="vtt-muted vtt-link-now">
                      {stats ? `${Math.round(stats.rttMs)} ms` : '—'}
                    </span>
                  </span>
                ) : (
                  <span className="vtt-muted vtt-link-numbers">{describeLink(stats)}</span>
                ))}
            </div>
            {mixer && (
              <div className="vtt-player-vol">
                <Slider
                  aria-label={`${primary}'s volume`}
                  size="1"
                  min={0}
                  max={PLAYER_VOLUME_MAX}
                  step={0.05}
                  value={[shown]}
                  onValueChange={([v]) => setValues((s) => ({ ...s, [m.userId]: v ?? 1 }))}
                  onValueCommit={([v]) => setVolume(m.userId, v ?? 1)}
                />
                <output className="vtt-set-out">{Math.round(shown * 100)}%</output>
                <ToolButton
                  label={`Reset ${primary} to 100%`}
                  onClick={() => setVolume(m.userId, 1)}
                  disabled={Math.abs(shown - 1) < 0.01}
                >
                  <RotateCcw size={13} />
                </ToolButton>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
