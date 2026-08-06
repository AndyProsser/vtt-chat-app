import { extractDdbIdentity } from '@vtt-chat-app/ddb';
import { useEffect } from 'react';

import { requestSession } from '../lib/backendClient.js';
import { useLiveKitStore } from '../lib/store.js';
import { connectLiveKit, onCobaltCookieDetected, onLiveKitState } from '../lib/tauriBridge.js';

/**
 * Wires the whole Stage 1 pipeline: cobalt cookie event -> ddb/ identity extraction -> backend
 * session request -> rust-livekit connect, plus applying `livekit:state` events back into the
 * store. Call once from the overlay root — see docs/architecture/DDB-AUTH.md for the flow.
 */
export function useOverlayBridge(): void {
  const applyState = useLiveKitStore((state) => state.applyState);

  useEffect(() => {
    let cancelled = false;

    const unlistenState = onLiveKitState((state) => {
      if (!cancelled) applyState(state);
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
      void unlistenCookie.then((unlisten) => unlisten());
    };
  }, [applyState]);
}
