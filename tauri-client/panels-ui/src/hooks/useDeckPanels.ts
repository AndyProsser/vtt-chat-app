import { useCallback, useState } from 'react';

import { parsePanels, togglePanel, type DeckPanels, type PanelName } from '../lib/deckPanels.js';

const KEY = 'vtt.deckPanels';

/** Which of Voice, Stingers and Scenes are open, remembered on this machine between sessions. */
export function useDeckPanels() {
  const [panels, setPanels] = useState<DeckPanels>(() => {
    try {
      return parsePanels(localStorage.getItem(KEY));
    } catch {
      return parsePanels(null);
    }
  });
  const toggle = useCallback((name: PanelName) => {
    setPanels((current) => {
      const next = togglePanel(current, name);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* remembering is a convenience */
      }
      return next;
    });
  }, []);
  return { panels, toggle };
}
