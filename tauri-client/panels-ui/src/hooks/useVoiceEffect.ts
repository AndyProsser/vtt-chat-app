import { useCallback, useEffect, useRef, useState } from 'react';

import {
  accountErrorMessage,
  campaignApi,
  onVoiceEffect,
  voiceEffectGet,
  voiceEffectSet,
} from '../lib/tauriBridge.js';

/** The DM's current character voice, followed live (it resets to `normal` when voice is left). */
export function useVoiceEffect() {
  const [current, setCurrent] = useState('normal');
  const [error, setError] = useState<string>();
  const reported = useRef('normal');
  useEffect(() => {
    let cancelled = false;
    void voiceEffectGet().then(
      (v) => {
        if (cancelled) return;
        reported.current = v;
        setCurrent(v);
      },
      () => undefined,
    );
    const unlisten = onVoiceEffect((v) => {
      if (cancelled) return;
      setCurrent(v);
      // Tell the server (metadata only, for the recording's timeline: the voice runs in Rust, so the
      // server cannot see it). A failure must never disturb the voice.
      if (v !== reported.current) {
        reported.current = v;
        void campaignApi('POST', 'recordings/voice-effect', { voice: v }).catch(() => undefined);
      }
    });
    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, []);
  const choose = useCallback(async (name: string) => {
    setError(undefined);
    try {
      await voiceEffectSet(name);
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }, []);
  return { current, error, choose };
}
