import { useEffect, useState } from 'react';

import { ddbStatus } from '../lib/tauriBridge.js';

/** Whether this server has D&D Beyond sync on, asked once per window (undefined until it answers). */
export function useDdbEnabled(): boolean | undefined {
  const [enabled, setEnabled] = useState<boolean>();
  useEffect(() => {
    let cancelled = false;
    ddbStatus()
      .then((s) => !cancelled && setEnabled(s.enabled))
      .catch(() => !cancelled && setEnabled(false));
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
