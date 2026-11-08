import { useCallback, useEffect, useState } from 'react';

import type { UpdateInfo } from '../lib/updateInfo.js';
import { accountErrorMessage, updateCheck, updateInstall } from '../lib/tauriBridge.js';

const FIRST_CHECK_MS = 15_000; // not during start-up, when the window is still settling
const RECHECK_MS = 6 * 60 * 60 * 1000;

/**
 * Looks for a newer client shortly after the window opens and every few hours after, and installs it
 * only when asked. "No update", "no server yet" and a server without updates are all quiet: only a
 * check the player started themselves shows an error.
 */
export function useUpdate(automatic: boolean) {
  const [available, setAvailable] = useState<UpdateInfo>();
  const [busy, setBusy] = useState<'checking' | 'installing'>();
  const [error, setError] = useState<string>();

  const check = useCallback(async (manual: boolean) => {
    setBusy('checking');
    setError(undefined);
    try {
      setAvailable((await updateCheck()) ?? undefined);
    } catch (e) {
      if (manual) setError(accountErrorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }, []);

  useEffect(() => {
    if (!automatic) return;
    const first = window.setTimeout(() => void check(false), FIRST_CHECK_MS);
    const again = window.setInterval(() => void check(false), RECHECK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(again);
    };
  }, [automatic, check]);

  const install = useCallback(async () => {
    setBusy('installing');
    setError(undefined);
    try {
      await updateInstall(); // restarts the app on success
    } catch (e) {
      setError(accountErrorMessage(e));
      setBusy(undefined);
    }
  }, []);

  return { available, busy, error, check, install };
}
