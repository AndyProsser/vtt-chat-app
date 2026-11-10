import { useCallback, useState } from 'react';

import { accountErrorMessage, statusSet } from '../lib/tauriBridge.js';
import { useStatusStore, type Status } from '../lib/statusStore.js';

/** The player's status and a way to change it (joining voice can take a moment and can fail). */
export function useStatus() {
  const status = useStatusStore((state) => state.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const change = useCallback(async (next: Status) => {
    setBusy(true);
    setError(undefined);
    try {
      await statusSet(next);
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, error, change };
}
