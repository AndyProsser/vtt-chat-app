import { useCallback, useEffect, useState } from 'react';

import {
  accountAddCampaign,
  accountErrorMessage,
  accountSelectCampaign,
  accountSignIn,
  accountSignOut,
  accountStatus,
  onAccountChanged,
  onAccountError,
} from '../lib/tauriBridge.js';
import type { AccountStatus } from '../types/index.js';

export interface AccountApi {
  status: AccountStatus | undefined;
  busy: boolean;
  error: string | undefined;
  signIn: (server: string, email: string, password: string) => Promise<void>;
  selectCampaign: (id: string) => Promise<void>;
  addCampaign: (action: 'join' | 'create' | 'refresh', value: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/** The account panel's view of Rust's account state; every action replaces `status` wholesale. */
export function useAccount(): AccountApi {
  const [status, setStatus] = useState<AccountStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void accountStatus().then((s) => !cancelled && setStatus(s));
    const unlistenError = onAccountError((e) => !cancelled && setError(e.message));
    // Another window (or a revoked session) changed the account: follow it.
    const unlistenChanged = onAccountChanged(() => {
      void accountStatus().then((s) => !cancelled && setStatus(s));
    });
    return () => {
      cancelled = true;
      void unlistenError.then((fn) => fn());
      void unlistenChanged.then((fn) => fn());
    };
  }, []);

  const run = useCallback(async (action: () => Promise<AccountStatus>) => {
    setBusy(true);
    setError(undefined);
    try {
      setStatus(await action());
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    busy,
    error,
    signIn: (server, email, password) => run(() => accountSignIn(server, email, password)),
    selectCampaign: (id) => run(() => accountSelectCampaign(id)),
    addCampaign: (action, value) => run(() => accountAddCampaign(action, value)),
    signOut: () => run(accountSignOut),
  };
}
