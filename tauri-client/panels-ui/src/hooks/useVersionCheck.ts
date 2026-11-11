import { useEffect, useState } from 'react';

import { serverVersionCheck, type VersionCheck } from '../lib/tauriBridge.js';
import { useConnected } from './useConnected.js';

/**
 * Compares this app's version with the server's once when the window opens and again when voice
 * (re)connects. Deliberately no timer: the app stays quiet when idle, and a server only changes
 * version when its operator upgrades it, which restarts the connection anyway.
 */
export function useVersionCheck(): VersionCheck | undefined {
  const connected = useConnected();
  const [check, setCheck] = useState<VersionCheck>();
  useEffect(() => {
    let cancelled = false;
    serverVersionCheck().then(
      (c) => !cancelled && setCheck(c),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [connected]);
  return check;
}
