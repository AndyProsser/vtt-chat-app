import { useEffect, useRef } from 'react';

/**
 * When a sheet closes (`listShowing` turns true again), put the keyboard focus back on the control that opened it. The
 * control is found by a `data-focus` marker rather than a ref, because the page behind a sheet is rebuilt when the
 * sheet closes.
 */
export function useReturnFocus(listShowing: boolean, key: string): void {
  const was = useRef(listShowing);
  const opener = useRef(key);
  // The key that counts is the one from while the sheet was up.
  if (!listShowing) opener.current = key;
  useEffect(() => {
    if (!was.current && listShowing) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-focus="${opener.current}"]`)?.focus(),
      );
    }
    was.current = listShowing;
  }, [listShowing]);
}
