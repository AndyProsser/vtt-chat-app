import { useEffect, useState } from 'react';

import { onConnectLink, takePendingConnect } from '../lib/tauriBridge.js';
import type { ConnectLink } from '../types/index.js';

/**
 * The `vtt-chat://connect` link the app was opened with, if any: asked for on mount, and followed
 * live. It only ever fills the Connect screen's fields; the player still presses Connect.
 */
export function useConnectLink(): ConnectLink | undefined {
  const [link, setLink] = useState<ConnectLink>();
  useEffect(() => {
    let cancelled = false;
    void takePendingConnect().then((l) => !cancelled && l && setLink(l));
    const unlisten = onConnectLink((l) => !cancelled && setLink(l));
    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, []);
  return link;
}
