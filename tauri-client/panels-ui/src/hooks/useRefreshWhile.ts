import { useEffect, useRef } from 'react';

/**
 * Calls `refresh` when `active` turns on and each time the window gets focus again, for a view that shows a list the app
 * only reads on request (the campaign chooser: a campaign deleted or renamed elsewhere must not linger in it).
 */
export function useRefreshWhile(active: boolean, refresh: () => void): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!active) return;
    const run = () => latest.current();
    run();
    window.addEventListener('focus', run);
    return () => window.removeEventListener('focus', run);
  }, [active]);
}
