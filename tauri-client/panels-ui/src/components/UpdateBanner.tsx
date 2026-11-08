import { useState } from 'react';

import { useUpdate } from '../hooks/useUpdate.js';
import { updateMessage } from '../lib/updateInfo.js';

/** A quiet strip when a newer client is available. Nothing installs, or restarts, until it is clicked. */
export function UpdateBanner() {
  const { available, busy, error, install } = useUpdate(true);
  const [dismissed, setDismissed] = useState<string>();
  if (!available || dismissed === available.version) return null;
  return (
    <div className="vtt-update" role="status">
      <span>{error ?? updateMessage(available)}</span>
      <button
        type="button"
        className="vtt-pill"
        disabled={busy === 'installing'}
        onClick={() => void install()}
      >
        {busy === 'installing' ? 'Installing…' : 'Restart to update'}
      </button>
      <button type="button" className="vtt-pill" onClick={() => setDismissed(available.version)}>
        Later
      </button>
    </div>
  );
}
