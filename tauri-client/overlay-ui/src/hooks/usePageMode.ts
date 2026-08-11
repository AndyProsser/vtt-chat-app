import { useEffect, useState } from 'react';

import { classifyPage, subscribeToPageModeChanges, type OverlayMode } from '../lib/pageMode.js';

/** Re-classifies on navigation — see `subscribeToPageModeChanges` for what triggers it. */
export function usePageMode(): OverlayMode {
  const [mode, setMode] = useState<OverlayMode>(() => classifyPage(new URL(window.location.href)));

  useEffect(() => {
    const recompute = () => setMode(classifyPage(new URL(window.location.href)));
    recompute();
    return subscribeToPageModeChanges(recompute);
  }, []);

  return mode;
}
