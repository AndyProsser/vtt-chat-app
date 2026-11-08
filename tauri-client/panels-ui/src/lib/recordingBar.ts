import type { RecordingAction, RecordingView } from '../types/index.js';
import { elapsedSince, formatElapsed } from './elapsed.js';
import { recordingActions } from './tableModel.js';

export interface RecordingBar {
  /** Whether the REC indicator and timer show. */
  visible: boolean;
  label: string;
  paused: boolean;
  /** Buttons for this viewer: only the DM has any. */
  actions: RecordingAction[];
}

/** What the top bar shows about the recording, for a player or the DM, at time `now` (epoch ms). */
export function recordingBar(
  recording: RecordingView | null,
  dm: boolean,
  now: number,
): RecordingBar {
  return {
    visible: recording !== null,
    label: formatElapsed(elapsedSince(recording?.startedAt ?? null, now)),
    paused: recording !== null && !recording.capturing,
    actions: dm ? recordingActions(recording) : [],
  };
}
