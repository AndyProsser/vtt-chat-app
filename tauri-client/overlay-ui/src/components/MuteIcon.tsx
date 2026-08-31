import { IconButton, Tooltip } from '@radix-ui/themes';
import { memo, useCallback } from 'react';

import { useConnected } from '../hooks/useConnected.js';
import { useMicrophoneMuted } from '../hooks/useMicrophoneMuted.js';
import { useShadowPortalContainer } from '../lib/shadowRootContext.js';
import { setMicrophoneMuted } from '../lib/tauriBridge.js';

/**
 * Replaces Stage 3a's `MuteButton` — icon-only (the compact view's first element) with a
 * tooltip carrying the text detail instead of an always-visible label. Adds a third visual
 * state, "not connected", distinct from "muted" — see ROADMAP.md's Stage 3a entry on the
 * confusion this closes.
 */
export const MuteIcon = memo(function MuteIcon() {
  const connected = useConnected();
  const muted = useMicrophoneMuted();
  const container = useShadowPortalContainer();

  const handleClick = useCallback(() => {
    void setMicrophoneMuted(!muted).catch((err: unknown) => {
      console.error('[overlay-ui] failed to set microphone mute state', err);
    });
  }, [muted]);

  const label = !connected
    ? 'Not connected — mic controls have no effect yet'
    : muted
      ? 'Mic muted — hold Left Ctrl to talk'
      : 'Mic live';

  return (
    <Tooltip content={label} container={container}>
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
