import { useEffect } from 'react';

import { useMicrophoneStore } from '../lib/microphoneStore.js';
import { useSpeakingStore } from '../lib/speakingStore.js';
import { useLiveKitStore } from '../lib/store.js';
import { onLiveKitState, onMicrophoneState, onSpeakersChanged } from '../lib/tauriBridge.js';

/**
 * Applies the Rust core's events to the panel's stores. The core owns audio and the server
 * connection; a panel is only a cache of it (docs/architecture/STATE-AND-RESILIENCE.md). Call
 * once from the panel root. Stage 4 adds snapshot-on-open hydration here.
 */
export function usePanelBridge(): void {
  const applyState = useLiveKitStore((state) => state.applyState);
  const applyMuted = useMicrophoneStore((state) => state.applyMuted);
  const applySpeakers = useSpeakingStore((state) => state.applySpeakers);

  useEffect(() => {
    let cancelled = false;

    const unlisteners = [
      onLiveKitState((state) => {
        if (!cancelled) applyState(state);
      }),
      onMicrophoneState(({ muted }) => {
        if (!cancelled) applyMuted(muted);
      }),
      onSpeakersChanged(({ speakingIdentities }) => {
        if (!cancelled) applySpeakers(speakingIdentities);
      }),
    ];

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) void unlisten.then((fn) => fn());
    };
  }, [applyState, applyMuted, applySpeakers]);
}
