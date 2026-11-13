import { useCallback, useEffect, useRef, useState } from 'react';

import { CONFIRM_WINDOW_MS } from '../consts/account.js';

/**
 * Confirm-by-second-click for a destructive button: the first press arms it (the button shows its
 * "press again" wording), a second press inside the window runs the action, and it disarms by itself.
 * No dialog, so it works the same with a keyboard, a screen reader and a thumb.
 */
export function useConfirmClick(action: () => void | Promise<void>, windowMs = CONFIRM_WINDOW_MS) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(action);
  latest.current = action;
  useEffect(() => () => clearTimeout(timer.current), []);
  const press = useCallback(() => {
    clearTimeout(timer.current);
    if (armed) {
      setArmed(false);
      void latest.current();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), windowMs);
  }, [armed, windowMs]);
  return { armed, press };
}
