import { useEffect, useRef } from 'react';

import { chatHistory } from '../lib/phone/phoneApi.js';
import { usePhoneStore } from '../lib/phone/phoneStore.js';
import { type SayOptions, LiveSocket, socketUrl } from '../lib/phone/socket.js';

/**
 * Keeps the open campaign's chat live: loads the recent history, opens the connection, and hands its
 * events to the store. Returns a sender that reports whether the line went out.
 */
export function useLiveChat(campaignId: string, onRevoked: () => void) {
  const socket = useRef<LiveSocket>(undefined);
  const revoked = useRef(onRevoked);
  revoked.current = onRevoked;

  useEffect(() => {
    const store = usePhoneStore.getState();
    let current = true;
    chatHistory(campaignId)
      .then((lines) => {
        if (current) store.addLines(lines);
      })
      .catch(() => undefined);
    const live = new LiveSocket({
      url: socketUrl(window.location),
      campaignId,
      onEvent: (t, d) => usePhoneStore.getState().onFrame(t, d),
      onState: (s) => usePhoneStore.getState().setLive(s),
      onRevoked: () => revoked.current(),
    });
    socket.current = live;
    live.start();
    // A phone that was asleep reconnects when the page comes back, not after the next timer.
    const wake = () => {
      if (document.visibilityState === 'visible' && usePhoneStore.getState().live === 'offline') {
        live.stop();
        live.start();
      }
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      current = false;
      document.removeEventListener('visibilitychange', wake);
      live.stop();
      socket.current = undefined;
    };
  }, [campaignId]);

  return (text: string, o?: SayOptions): boolean => socket.current?.say(text, o) ?? false;
}
