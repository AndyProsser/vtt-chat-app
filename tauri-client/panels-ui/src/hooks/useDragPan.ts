import { useMemo, useRef, type PointerEvent, type RefObject } from 'react';

/** The drag logic, apart from React so it can be tested: scroll the frame opposite to the pointer's movement. */
export function createDragPan(getFrame: () => HTMLElement | null, isEnabled: () => boolean) {
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  return {
    onPointerDown: (e: PointerEvent) => {
      const el = getFrame();
      if (!el || !isEnabled() || e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    },
    onPointerMove: (e: PointerEvent) => {
      const el = getFrame();
      if (!el || !drag) return;
      el.scrollLeft = drag.left - (e.clientX - drag.x);
      el.scrollTop = drag.top - (e.clientY - drag.y);
    },
    onPointerUp: () => {
      drag = null;
    },
    onPointerCancel: () => {
      drag = null;
    },
  };
}

/**
 * Drag to move around a scrollable frame (a zoomed picture or a PDF page). Spread the returned handlers on the
 * frame; with `enabled` false they do nothing, so the frame keeps its ordinary scrolling.
 */
export function useDragPan(frame: RefObject<HTMLElement | null>, enabled: boolean) {
  const on = useRef(enabled);
  on.current = enabled;
  return useMemo(
    () =>
      createDragPan(
        () => frame.current,
        () => on.current,
      ),
    [frame],
  );
}
