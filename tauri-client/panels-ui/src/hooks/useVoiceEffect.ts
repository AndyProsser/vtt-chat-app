import { useCallback, useEffect, useState } from 'react';

import {
  accountErrorMessage,
  onVoiceEffect,
  voiceEffectGet,
  voiceEffectSet,
} from '../lib/tauriBridge.js';

/** The DM's current character voice, followed live (it resets to `normal` when voice is left). */
export function useVoiceEffect() {
  const [current, setCurrent] = useState('normal');
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    void voiceEffectGet().then(
      (v) => !cancelled && setCurrent(v),
      () => undefined,
    );
    const unlisten = onVoiceEffect((v) => !cancelled && setCurrent(v));
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
