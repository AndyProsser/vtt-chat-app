import { useEffect, useState } from 'react';

import { onSyncEvent } from '../lib/tauriBridge.js';

/** The id of the scene playing now, from the server's `scene.started` / `scene.stopped` events (unknown until one arrives). */
export function useActiveScene(): string | undefined {
  const [sceneId, setSceneId] = useState<string>();
  useEffect(() => {
    const unlisten = onSyncEvent((e) => {
      if (e.t === 'scene.started') {
        const id = (e.d as { sceneId?: unknown } | undefined)?.sceneId;
        setSceneId(typeof id === 'string' ? id : undefined);
      } else if (e.t === 'scene.stopped') setSceneId(undefined);
    });
    return () => void unlisten.then((fn) => fn());
  }, []);
  return sceneId;
}
