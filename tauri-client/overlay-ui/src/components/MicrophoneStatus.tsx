import { memo } from 'react';

import { useMicrophoneMuted } from '../hooks/useMicrophoneMuted.js';

/**
 * Leaf-isolated per docs/architecture/STATE-AND-RESILIENCE.md — subscribes to one field only.
 * This is the most churn-prone leaf in the overlay: it re-renders on every push-to-talk press,
 * so it must never pull in the participant list or connection state alongside it.
 */
export const MicrophoneStatus = memo(function MicrophoneStatus() {
  const muted = useMicrophoneMuted();
  return (
    <div className={muted ? 'vtt-mic vtt-mic-muted' : 'vtt-mic vtt-mic-live'}>
      {muted ? 'Mic muted — hold Left Ctrl to talk' : 'Mic live'}
    </div>
  );
});
