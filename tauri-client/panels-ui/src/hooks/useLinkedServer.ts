import { useEffect, useState } from 'react';

import { onLinkedServer, takePendingServer } from '../lib/tauriBridge.js';

/** The server address an invite link supplied, if any: asked for on mount, and followed live. */
export function useLinkedServer(): string | undefined {
  const [server, setServer] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    void takePendingServer().then((s) => !cancelled && s && setServer(s));
    const unlisten = onLinkedServer((s) => !cancelled && setServer(s));
    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, []);
  return server;
}
