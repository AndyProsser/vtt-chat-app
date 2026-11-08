import { useCallback, useState } from 'react';

import { nextVoiceAction } from '../lib/voice.js';
import { accountErrorMessage, disconnectLiveKit, voiceConnect } from '../lib/tauriBridge.js';
import { useConnected } from './useConnected.js';

/** The voice connection as the Connect/Disconnect button sees it; chat works either way. */
export function useVoice() {
  const connected = useConnected();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const toggle = useCallback(async () => {
    const action = nextVoiceAction(connected, busy);
    if (action === 'wait') return;
    setBusy(true);
    setError(undefined);
    try {
      await (action === 'connect' ? voiceConnect() : disconnectLiveKit());
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [connected, busy]);

  return { connected, busy, error, toggle };
}
