import { Circle, Pause, Play, Square } from 'lucide-react';

import { useDmAwaySince } from '../hooks/useDmAwaySince.js';
import { useNow } from '../hooks/useNow.js';
import { dmAwayLongEnough } from '../lib/dmAway.js';
import { recordingBar } from '../lib/recordingBar.js';
import { recordingControl } from '../lib/tauriBridge.js';
import { useTableStore } from '../lib/tableStore.js';
import type { RecordingAction } from '../types/index.js';
import { ToolButton } from './ToolButton.js';

const CONTROL: Record<RecordingAction, { label: string; icon: typeof Pause }> = {
  start: { label: 'Start recording', icon: Circle },
  pause: { label: 'Pause recording', icon: Pause },
  resume: { label: 'Resume recording', icon: Play },
  stop: { label: 'Stop recording', icon: Square },
};

/**
 * REC state and timer for everyone; the DM also gets the controls, and so does any player once the DM
 * has been disconnected longer than the grace period. The timer ticks only while recording.
 */
export function RecordingIndicator({ dm }: { dm: boolean }) {
  const recording = useTableStore((s) => s.recording);
  const now = useNow(recording !== null);
  const awaySince = useDmAwaySince();
  const stepIn =
    !dm && recording !== null && dmAwayLongEnough(awaySince, now, recording.graceSeconds);
  const bar = recordingBar(recording, dm, now, stepIn);
  return (
    <>
      {bar.visible && (
        <span className={bar.paused ? 'vtt-rec vtt-rec-paused' : 'vtt-rec'} role="status">
          <span className="vtt-rec-dot" aria-hidden />
          {bar.paused ? 'PAUSED' : 'REC'} {bar.label}
        </span>
      )}
      {bar.actions.map((action) => {
        const { label, icon: Icon } = CONTROL[action];
        return (
          <ToolButton
            key={action}
            label={label}
            danger={action === 'start'}
            onClick={() => void recordingControl(action).catch(console.error)}
          >
            <Icon size={14} />
          </ToolButton>
        );
      })}
    </>
  );
}
