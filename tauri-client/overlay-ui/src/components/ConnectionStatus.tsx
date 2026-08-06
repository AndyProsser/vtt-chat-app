import { memo } from 'react';

import { useConnected } from '../hooks/useConnected.js';

/** Leaf-isolated per docs/architecture/STATE-AND-RESILIENCE.md — subscribes to one field only. */
export const ConnectionStatus = memo(function ConnectionStatus() {
  const connected = useConnected();
  return <div className="vtt-status">{connected ? 'Connected' : 'Connecting…'}</div>;
});
