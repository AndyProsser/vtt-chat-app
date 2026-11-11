import { useEffect } from 'react';

import { SESSION_LIFETIME_MS } from '../consts/index.js';
import { signOut } from '../lib/api.js';

/** Signs the browser session out when the page goes away or after the lifetime, whichever is first. */
export function useSessionEnd(token: string): void {
  useEffect(() => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      void signOut(token);
    };
    window.addEventListener('pagehide', end);
    const timer = setTimeout(end, SESSION_LIFETIME_MS);
    return () => {
      window.removeEventListener('pagehide', end);
      clearTimeout(timer);
    };
  }, [token]);
}
