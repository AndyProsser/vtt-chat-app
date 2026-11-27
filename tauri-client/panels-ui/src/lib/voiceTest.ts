export type VoiceTestPhase = 'idle' | 'recording' | 'ready' | 'playing';

/** Where the voice test is (Settings → Audio → Test your voice); mirrors `voice_test_status`. */
export interface VoiceTestStatus {
  phase: VoiceTestPhase;
  elapsedMs: number;
  totalMs: number;
  /** The voice level while recording, 0 to 1. */
  level: number;
  error: string | null;
  hasClip: boolean;
}

export const IDLE_VOICE_TEST: VoiceTestStatus = {
  phase: 'idle',
  elapsedMs: 0,
  totalMs: 0,
  level: 0,
  error: null,
  hasClip: false,
};

/** The lengths offered, in seconds. */
export const VOICE_TEST_SECONDS = [5, 10] as const;

/** A recording or a playback is in progress (the status is polled only then). */
export function isVoiceTestBusy(status: VoiceTestStatus): boolean {
  return status.phase === 'recording' || status.phase === 'playing';
}

const seconds = (ms: number): number => Math.floor(ms / 1000);

/** One line saying what is happening, for under the buttons. */
export function voiceTestText(status: VoiceTestStatus): string {
  const total = Math.max(1, Math.round(status.totalMs / 1000));
  switch (status.phase) {
    case 'recording':
      return `Recording… ${seconds(status.elapsedMs)} of ${total} s. Say a few sentences the way you talk at the table.`;
    case 'playing':
      return `Playing… ${seconds(status.elapsedMs)} of ${total} s.`;
    case 'ready':
      return `A ${total} s recording is ready. Play it in each tone and compare.`;
    default:
      return 'Records a few seconds of your voice as it would be sent, then plays it back in any tone. Wear headphones. Nothing is saved or sent.';
  }
}
