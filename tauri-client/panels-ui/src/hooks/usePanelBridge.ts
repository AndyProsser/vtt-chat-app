import { useEffect } from 'react';

import { useMicrophoneStore } from '../lib/microphoneStore.js';
import { useSpeakingStore } from '../lib/speakingStore.js';
import { useLiveKitStore } from '../lib/store.js';
import { useStatusStore } from '../lib/statusStore.js';
import {
  livekitSnapshot,
  onLiveKitState,
  onMicrophoneState,
  onSpeakersChanged,
  onStatus,
  statusGet,
} from '../lib/tauriBridge.js';

/**
 * Applies the Rust core's events to the panel's stores. The core owns audio and the server
 * connection; a panel is only a cache of it (docs/architecture/STATE-AND-RESILIENCE.md). Call
 * once from the panel root. Stage 4 adds snapshot-on-open hydration here.
 */
export function usePanelBridge(): void {
  const applyState = useLiveKitStore((state) => state.applyState);
  const applyMuted = useMicrophoneStore((state) => state.applyMuted);
  const applySpeakers = useSpeakingStore((state) => state.applySpeakers);
  const applyStatus = useStatusStore((state) => state.applyStatus);

  useEffect(() => {
    let cancelled = false;

    const unlisteners = [
      onLiveKitState((state) => {
        if (!cancelled) applyState(state);
      }),
      onMicrophoneState(({ muted }) => {
        if (!cancelled) applyMuted(muted);
      }),
      onStatus((status) => {
        if (!cancelled) applyStatus(status);
      }),
      onSpeakersChanged(({ speakingIdentities }) => {
        if (!cancelled) applySpeakers(speakingIdentities);
      }),
    ];

    // Listen first, then ask: a change in between is applied by the event, and the snapshot is current.
    void livekitSnapshot().then(
      ([state, mic]) => {
        if (cancelled) return;
        applyState(state);
        applyMuted(mic.muted);
      },
      (e: unknown) => console.error('[panels-ui] voice snapshot failed', e),
    );

    void statusGet().then(
      (status) => !cancelled && applyStatus(status),
      (e: unknown) => console.error('[panels-ui] status read failed', e),
    );

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) void unlisten.then((fn) => fn());
    };
  }, [applyState, applyMuted, applySpeakers, applyStatus]);
}
