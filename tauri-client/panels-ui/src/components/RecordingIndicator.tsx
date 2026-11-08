import { PauseIcon, PlayIcon, DotFilledIcon, StopIcon } from '@radix-ui/react-icons';

import { useNow } from '../hooks/useNow.js';
import { recordingBar } from '../lib/recordingBar.js';
import { recordingControl } from '../lib/tauriBridge.js';
import { useTableStore } from '../lib/tableStore.js';
import type { RecordingAction } from '../types/index.js';

const ICON: Record<RecordingAction, typeof PauseIcon> = {
  start: DotFilledIcon,
  pause: PauseIcon,
  resume: PlayIcon,
  stop: StopIcon,
};

/** REC state and timer for everyone; the DM also gets the controls. The timer ticks only while recording. */
export function RecordingIndicator({ dm }: { dm: boolean }) {
  const recording = useTableStore((s) => s.recording);
  const now = useNow(recording !== null);
  const bar = recordingBar(recording, dm, now);
  return (
    <>
      {bar.visible && (
        <span className={bar.paused ? 'vtt-rec vtt-rec-paused' : 'vtt-rec'} role="status">
          <span className="vtt-rec-dot" aria-hidden />
          {bar.paused ? 'PAUSED' : 'REC'} {bar.label}
        </span>
      )}
      {bar.actions.map((action) => {
        const Icon = ICON[action];
        return (
          <button
            key={action}
            type="button"
            className="vtt-pill"
            aria-label={`${action} recording`}
            onClick={() => void recordingControl(action).catch(console.error)}
          >
            <Icon /> {action === 'start' ? 'Record' : ''}
          </button>
        );
      })}
    </>
  );
}
