import type { RecordingAction, RecordingView } from '../types/index.js';
import { elapsedSince, formatElapsed } from './elapsed.js';
import { recordingActions } from './tableModel.js';

export interface RecordingBar {
  /** Whether the REC indicator and timer show. */
  visible: boolean;
  label: string;
  paused: boolean;
  /** Buttons for this viewer: the DM's, or a player's once the DM has been away past the grace period. */
  actions: RecordingAction[];
  /** What the notice says about where this session is processed (CLAUDE.md §8.4); `null` when not recording. */
  notice: string | null;
  /** The content leaves the operator's network: shown as a warning chip, not only in the tooltip. */
  offsite: boolean;
}

/** What the top bar shows about the recording, for a player or the DM, at time `now` (epoch ms). */
export function recordingBar(
  recording: RecordingView | null,
  dm: boolean,
  now: number,
  /** The DM has been away past the grace period: a player may pause, resume or stop (never start). */
  stepIn = false,
): RecordingBar {
  return {
    visible: recording !== null,
    label: formatElapsed(elapsedSince(recording?.startedAt ?? null, now)),
    paused: recording !== null && !recording.capturing,
    actions: dm
      ? recordingActions(recording)
      : stepIn && recording
        ? recordingActions(recording)
        : [],
    notice: recording === null ? null : processingNotice(recording.processing),
    offsite: recording?.processing === 'offsite',
  };
}

/** The one sentence everyone sees about where a recorded session is processed. An older server says nothing. */
export function processingNotice(processing: RecordingView['processing']): string {
  if (processing === 'offsite')
    return 'This session is sent off-site to be processed (the server’s operator chose an outside service).';
  if (processing === 'local')
    return 'This session is processed on the server’s own network; it does not leave it.';
  return 'Where this session is processed is not reported by this server.';
}
