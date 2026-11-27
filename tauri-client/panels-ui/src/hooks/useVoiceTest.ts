import { useCallback, useEffect, useState } from 'react';

import { isPageVisible } from '../lib/pageVisibility.js';
import {
  voiceTestClear,
  voiceTestPlay,
  voiceTestRecord,
  voiceTestStatus,
  voiceTestStop,
} from '../lib/tauriBridge.js';
import { IDLE_VOICE_TEST, isVoiceTestBusy, type VoiceTestStatus } from '../lib/voiceTest.js';
import type { VoicePresetName } from '../lib/voicePreset.js';

/**
 * The voice test's state and actions. The status is read when the panel appears and, while a recording or
 * playback is running, six times a second; when nothing is running no timer runs at all, and none runs
 * while the window is hidden (STATE-AND-RESILIENCE.md).
 */
export function useVoiceTest() {
  const [status, setStatus] = useState<VoiceTestStatus>(IDLE_VOICE_TEST);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setStatus(await voiceTestStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const busy = isVoiceTestBusy(status);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      if (isPageVisible()) void refresh();
    }, 160);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setError(undefined);
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      await refresh();
    },
    [refresh],
  );

  return {
    status,
    error: error ?? status.error ?? undefined,
    record: (seconds: number) => run(() => voiceTestRecord(seconds)),
    play: (preset: VoicePresetName) => run(() => voiceTestPlay(preset)),
    stop: () => run(voiceTestStop),
    clear: () => run(voiceTestClear),
  };
}
