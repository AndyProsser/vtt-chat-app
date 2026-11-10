import { AlertDialog, Button, Flex, IconButton, Tooltip } from '@radix-ui/themes';
import { Mic, MicOff } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import { useConnected } from '../hooks/useConnected.js';
import { useMicrophoneMuted } from '../hooks/useMicrophoneMuted.js';
import {
  accountErrorMessage,
  onOfferConnect,
  setMicrophoneMuted,
  statusSet,
} from '../lib/tauriBridge.js';

/**
 * Icon-only mute control with a tooltip carrying the text detail. Three visual states: live (mic),
 * muted (mic with a slash), and "not in voice" (a dimmed mic, distinct from muted). Pressing it while not in
 * voice asks "Connect to Voice Channel?"; yes goes Online and opens the microphone.
 */
export const MuteIcon = memo(function MuteIcon() {
  const connected = useConnected();
  const muted = useMicrophoneMuted();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();

  // The unmute hotkey pressed while not in voice asks the same question.
  useEffect(() => {
    const unlisten = onOfferConnect(() => setAsking(true));
    return () => void unlisten.then((fn) => fn());
  }, []);

  const handleClick = useCallback(() => {
    if (!connected) {
      setAsking(true);
      return;
    }
    void setMicrophoneMuted(!muted).catch((err: unknown) => {
      console.error('[panels-ui] failed to set microphone mute state', err);
    });
  }, [connected, muted]);

  const join = useCallback(async () => {
    setError(undefined);
    try {
      await statusSet('online');
      await setMicrophoneMuted(false);
      setAsking(false);
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }, []);

  const label = !connected
    ? 'Not in voice: click to join'
    : muted
      ? 'Mic muted — hold Left Ctrl to talk'
      : 'Mic live';

  return (
    <>
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
          {connected && muted ? (
            <MicOff size={14} aria-hidden="true" />
          ) : (
            <Mic size={14} aria-hidden="true" />
          )}
        </IconButton>
      </Tooltip>
      <AlertDialog.Root open={asking} onOpenChange={setAsking}>
        <AlertDialog.Content maxWidth="360px">
          <AlertDialog.Title>Connect to Voice Channel?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            You are Offline. Going Online joins the voice channel with your microphone on.
          </AlertDialog.Description>
          {error && (
            <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
              {error}
            </div>
          )}
          <Flex gap="3" justify="end" mt="4">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Not now
              </Button>
            </AlertDialog.Cancel>
            <Button onClick={() => void join()}>Connect</Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
});
