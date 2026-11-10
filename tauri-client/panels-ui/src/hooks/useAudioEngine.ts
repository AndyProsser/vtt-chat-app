import { useEffect, useState } from 'react';

import { isPageVisible, watchPageVisibility } from '../lib/pageVisibility.js';
import { useConnected } from './useConnected.js';
import { audioEngine, micLevel, type AudioEngineState } from '../lib/tauriBridge.js';

/**
 * The chosen and running audio engine. Read when the component appears and again whenever voice is
 * joined or left, because the running engine (`active`) is only known once a call has started.
 */
export function useAudioEngine(): AudioEngineState | undefined {
  const connected = useConnected();
  const [state, setState] = useState<AudioEngineState>();
  useEffect(() => {
    let cancelled = false;
    audioEngine().then(
      (s) => !cancelled && setState(s),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [connected]);
  return state;
}

/**
 * The microphone's level (0 to 1) while `enabled`, read ten times a second. Reads nothing while the
 * window is hidden or `enabled` is false: a hidden window runs no timers (STATE-AND-RESILIENCE.md).
 */
export function useMicLevel(enabled: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setLevel(0);
      return;
    }
    let timer: number | undefined;
    const read = () =>
      void micLevel().then(
        (v) => setLevel((old) => (v === null || v === old ? (v === null ? 0 : old) : v)),
        () => undefined,
      );
    const start = () => {
      stop();
      read();
      timer = window.setInterval(read, 100);
    };
    const stop = () => window.clearInterval(timer);
    if (isPageVisible()) start();
    const unwatch = watchPageVisibility(document, (visible) => (visible ? start() : stop()));
    return () => {
      unwatch();
      stop();
    };
  }, [enabled]);
  return level;
}
