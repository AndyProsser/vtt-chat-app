import { useEffect, useState } from 'react';

import { isPageVisible, watchPageVisibility } from '../lib/pageVisibility.js';

/**
 * A ticking `Date.now()`. The interval exists only while `active` AND the window is visible, so an
 * idle or hidden window has no timer; it resyncs the moment the window is shown again.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  const [visible, setVisible] = useState(() => isPageVisible());
  useEffect(() => watchPageVisibility(document, setVisible), []);
  useEffect(() => {
    if (!active || !visible) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, visible, intervalMs]);
  return now;
}
