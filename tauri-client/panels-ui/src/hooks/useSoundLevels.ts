import { useCallback, useEffect, useState } from 'react';

import { parseLevels, type SoundLevels } from '../lib/soundLevels.js';
import { soundboardLevelsSet } from '../lib/tauriBridge.js';

const KEY = 'vtt.soundLevels';

/** The DM's volume for stingers and for scenes: remembered here, and pushed to the app's mixer. */
export function useSoundLevels() {
  const [levels, setLevels] = useState<SoundLevels>(() => {
    try {
      return parseLevels(localStorage.getItem(KEY));
    } catch {
      return parseLevels(null);
    }
  });
  useEffect(() => {
    void soundboardLevelsSet(levels.stingers, levels.scenes).catch(() => undefined);
  }, [levels]);
  const set = useCallback((change: Partial<SoundLevels>) => {
    setLevels((current) => {
      const next = { ...current, ...change };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* remembering is a convenience */
      }
      return next;
    });
  }, []);
  return { levels, set };
}
