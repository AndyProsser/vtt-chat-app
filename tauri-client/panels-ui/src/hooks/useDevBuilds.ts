import { useEffect, useState } from 'react';

import { updateDevBuildsGet } from '../lib/tauriBridge.js';

/**
 * Whether this app has "Include dev builds" turned on (Settings → App). Read once per mount: it also
 * unlocks the diagnostic views, such as a recording's raw transcript for the DM. False until known.
 */
export function useDevBuilds(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void updateDevBuildsGet().then(
      (v) => !cancelled && setOn(v),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return on;
}
