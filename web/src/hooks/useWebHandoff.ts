import { useCallback, useState } from 'react';

import { createLinkCode } from '../lib/api.js';
import { handoffUrl } from '../lib/handoff.js';

export type HandoffState = 'idle' | 'working' | 'failed';

/**
 * Opens the web app already signed in: asks for a single-use link token for this session and navigates to
 * `/app#connect=<token>`. The link token is never logged or stored; this page's own session
 * cookie stays, so coming back still shows the signed-in view; the web app's redeem sets a fresh cookie of its own.
 */
export function useWebHandoff(): { state: HandoffState; open: () => void } {
  const [state, setState] = useState<HandoffState>('idle');
  const open = useCallback(() => {
    setState('working');
    createLinkCode().then(
      // an older server has no long token; the short code redeems the same way
      (res) => window.location.assign(handoffUrl(res.linkToken ?? res.code)),
      () => setState('failed'),
    );
  }, []);
  return { state, open };
}
