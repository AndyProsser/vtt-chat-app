import { extractDdbIdentity } from '@vtt-chat-app/ddb';
import { useEffect } from 'react';

import { requestSession } from '../lib/backendClient.js';
import { useMicrophoneStore } from '../lib/microphoneStore.js';
import { useOverlayVisibilityStore } from '../lib/overlayVisibilityStore.js';
import { useLiveKitStore } from '../lib/store.js';
import {
  connectLiveKit,
  onCobaltCookieDetected,
  onLiveKitState,
  onMicrophoneState,
  onOverlayToggle,
} from '../lib/tauriBridge.js';

/**
 * Wires the whole Stage 1 pipeline: cobalt cookie event -> ddb/ identity extraction -> backend
 * session request -> rust-livekit connect, plus applying `livekit:state` events back into the
 * store. Call once from the overlay root — see docs/architecture/DDB-AUTH.md for the flow.
 *
 * Stage 2 adds the two hotkey-driven events: `livekit:microphone` (push-to-talk / mute toggle)
 * and `overlay:toggle`. Each lands in its own store — see `microphoneStore` and
 * `overlayVisibilityStore` for why they aren't folded into `useLiveKitStore`.
 */
export function useOverlayBridge(): void {
  const applyState = useLiveKitStore((state) => state.applyState);
  const applyMuted = useMicrophoneStore((state) => state.applyMuted);
  const toggleVisibility = useOverlayVisibilityStore((state) => state.toggle);

  useEffect(() => {
    let cancelled = false;

    const unlistenState = onLiveKitState((state) => {
      if (!cancelled) applyState(state);
    });

    const unlistenMicrophone = onMicrophoneState(({ muted }) => {
      if (!cancelled) applyMuted(muted);
    });

    const unlistenOverlayToggle = onOverlayToggle(() => {
      if (!cancelled) toggleVisibility();
    });

    const unlistenCookie = onCobaltCookieDetected(({ cookieValue }) => {
      void (async () => {
        try {
          const identity = await extractDdbIdentity(cookieValue);
          const session = await requestSession(identity);
          await connectLiveKit(session.liveKit.url, session.liveKit.token);
        } catch (err) {
          console.error('[overlay-ui] failed to establish LiveKit session', err);
        }
      })();
    });

    return () => {
      cancelled = true;
      void unlistenState.then((unlisten) => unlisten());
      void unlistenMicrophone.then((unlisten) => unlisten());
      void unlistenOverlayToggle.then((unlisten) => unlisten());
      void unlistenCookie.then((unlisten) => unlisten());
    };
  }, [applyState, applyMuted, toggleVisibility]);
}
