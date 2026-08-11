import { Button } from '@radix-ui/themes';
import { memo, useCallback } from 'react';

import { useMicrophoneMuted } from '../hooks/useMicrophoneMuted.js';
import { setMicrophoneMuted } from '../lib/tauriBridge.js';

/**
 * The overlay's first interactive control, and the first to use Radix's `Button` rather than a
 * plain element — see `main.tsx` for the `Theme` provider this depends on, and `styles/theme.css`
 * for the `pointer-events` narrowing this required. Leaf-isolated per
 * docs/architecture/STATE-AND-RESILIENCE.md, same as `MicrophoneStatus`, which it sits next to.
 */
export const MuteButton = memo(function MuteButton() {
  const muted = useMicrophoneMuted();

  const handleClick = useCallback(() => {
    void setMicrophoneMuted(!muted).catch((err: unknown) => {
      console.error('[overlay-ui] failed to set microphone mute state', err);
    });
  }, [muted]);

  return (
    <Button
      type="button"
      size="1"
      color={muted ? 'gray' : 'green'}
      variant={muted ? 'soft' : 'solid'}
      onClick={handleClick}
    >
      {muted ? 'Unmute' : 'Mute'}
    </Button>
  );
});
