import { Popover, Slider } from '@radix-ui/themes';
import { Users } from 'lucide-react';
import { useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { useAudioEngine } from '../../hooks/useAudioEngine.js';
import { avatarColor } from '../../lib/avatarColor.js';
import { playerLines } from '../../lib/players.js';
import { initials, memberAvatar } from '../../lib/rail.js';
import { playerVolumeSet } from '../../lib/tauriBridge.js';
import { useTableStore } from '../../lib/tableStore.js';
import { Portrait } from '../Portrait.js';
import { ToolButton } from '../ToolButton.js';

/**
 * How loud the DM hears each player: one slider per person, the same per-person volume as on the rail (it is only
 * for this machine, saved by account, and needs the app's own audio engine). Here so a DM can fix the mix while
 * running the board.
 */
export function PlayerMix() {
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const engine = useAudioEngine();
  const [values, setValues] = useState<Record<string, number>>({});
  const others = members.filter((m) => m.userId !== status?.userId);
  const mixer = engine?.active === 'mixer';
  return (
    <Popover.Root>
      <Popover.Trigger>
        <ToolButton label="How loud you hear each player">
          <Users size={15} />
        </ToolButton>
      </Popover.Trigger>
      <Popover.Content size="1" align="end" className="vtt-deck-settings">
        <div className="vtt-set-pane">
          {!mixer && (
            <small className="vtt-muted">
              Per-player volume needs the app&apos;s own audio engine (Settings → Audio).
            </small>
          )}
          {mixer && others.length === 0 && (
            <small className="vtt-muted">Nobody else is here.</small>
          )}
          {mixer &&
            others.map((m) => {
              const { primary } = playerLines(m);
              const shown = values[m.userId] ?? engine.volumes[m.userId] ?? 1;
              return (
                <div key={m.userId} className="vtt-set-row">
                  <span className="vtt-av vtt-av-sm" style={{ background: avatarColor(m.userId) }}>
                    <Portrait avatarUrl={memberAvatar(m)} fallback={initials(primary)} size={13} />
                  </span>
                  <div className="vtt-set-label">
                    <span>{primary}</span>
                  </div>
                  <Slider
                    aria-label={`${primary}'s volume`}
                    size="1"
                    min={0}
                    max={2}
                    step={0.05}
                    value={[shown]}
                    onValueChange={([v]) => setValues((s) => ({ ...s, [m.userId]: v ?? 1 }))}
                    onValueCommit={([v]) =>
                      void playerVolumeSet(m.userId, v ?? 1).catch(console.error)
                    }
                    style={{ width: 110 }}
                  />
                  <output className="vtt-set-out">{Math.round(shown * 100)}%</output>
                </div>
              );
            })}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
