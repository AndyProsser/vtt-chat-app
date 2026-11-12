import { useEffect, useSyncExternalStore } from 'react';

import {
  getSessionState,
  markSignedIn,
  refreshSession,
  signOut,
  subscribeSession,
  type SignOutResult,
} from '../lib/session.js';

export interface SessionHook {
  /** True once the server has accepted this browser's session cookie. */
  signedIn: boolean;
  /** False until the first answer from the server (so a page can avoid flashing a sign-in form). */
  checked: boolean;
  /** Call after any sign-in form succeeds; the response has already set the cookie. */
  onSignedIn: () => void;
  /** Ends the session on the server and forgets it here. */
  signOut: () => Promise<SignOutResult>;
}

/** One behaviour for every page: ask the server once per load, follow sign-in and sign-out. */
export function useSession(): SessionHook {
  const state = useSyncExternalStore(subscribeSession, getSessionState, () => 'unknown' as const);
  useEffect(() => {
    void refreshSession();
  }, []);
  return {
    signedIn: state === 'in',
    checked: state !== 'unknown',
    onSignedIn: markSignedIn,
    signOut: () => signOut(),
  };
}
