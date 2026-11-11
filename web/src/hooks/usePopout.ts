import { useEffect, useReducer } from 'react';

import { pendingDelay, POPOUT_CLOSED, popoutReducer } from '../lib/phone/popout.js';

/** Runs the popout state machine (lib/phone/popout.ts): one timer while a hover change is waiting. */
export function usePopout() {
  const [state, send] = useReducer(popoutReducer, POPOUT_CLOSED);
  const delay = pendingDelay(state);
  const key = state.pending ? `${state.pending.id}:${state.pending.to}` : '';
  useEffect(() => {
    if (delay === undefined) return;
    const t = setTimeout(() => send({ type: 'timer' }), delay);
    return () => clearTimeout(t);
  }, [delay, key]);
  return [state, send] as const;
}
