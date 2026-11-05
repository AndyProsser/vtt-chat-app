import { IconButton, Tooltip } from '@radix-ui/themes';
import { memo, useCallback } from 'react';

import { useConnected } from '../hooks/useConnected.js';
import { useMicrophoneMuted } from '../hooks/useMicrophoneMuted.js';
import { setMicrophoneMuted } from '../lib/tauriBridge.js';

/**
 * Icon-only mute control with a tooltip carrying the text detail. Three visual states: live,
 * muted, and "not connected" (distinct from muted, so a dead mic isn't mistaken for a muted one).
 */
export const MuteIcon = memo(function MuteIcon() {
  const connected = useConnected();
  const muted = useMicrophoneMuted();

  const handleClick = useCallback(() => {
    void setMicrophoneMuted(!muted).catch((err: unknown) => {
      console.error('[panels-ui] failed to set microphone mute state', err);
    });
  }, [muted]);

  const label = !connected
    ? 'Not connected — mic controls have no effect yet'
    : muted
      ? 'Mic muted — hold Left Ctrl to talk'
      : 'Mic live';

  return (
    <Tooltip content={label}>
      <IconButton
        type="button"
        size="1"
        variant="soft"
        color={muted || !connected ? 'gray' : 'green'}
        className={connected ? 'vtt-mute-icon' : 'vtt-mute-icon vtt-mute-icon-disconnected'}
        onClick={handleClick}
        aria-label={label}
      >
        <span aria-hidden="true">{muted || !connected ? '○' : '●'}</span>
      </IconButton>
    </Tooltip>
  );
});
