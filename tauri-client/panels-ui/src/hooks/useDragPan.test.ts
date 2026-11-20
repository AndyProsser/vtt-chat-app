import type { PointerEvent } from 'react';
import { describe, expect, it } from 'vitest';

import { createDragPan } from './useDragPan.js';

const event = (x: number, y: number, button = 0) =>
  ({ clientX: x, clientY: y, pointerId: 1, button }) as unknown as PointerEvent;

function frame() {
  const el = document.createElement('div');
  el.setPointerCapture = () => undefined;
  el.scrollLeft = 100;
  el.scrollTop = 50;
  return el;
}

describe('useDragPan', () => {
  it('scrolls the frame opposite to the drag', () => {
    const el = frame();
    const pan = createDragPan(
      () => el,
      () => true,
    );
    pan.onPointerDown(event(200, 200));
    pan.onPointerMove(event(150, 180));
    expect(el.scrollLeft).toBe(150);
    expect(el.scrollTop).toBe(70);
    pan.onPointerUp();
    pan.onPointerMove(event(0, 0));
    expect(el.scrollLeft).toBe(150);
  });

  it('does nothing when disabled or for another mouse button', () => {
    const el = frame();
    const off = createDragPan(
      () => el,
      () => false,
    );
    off.onPointerDown(event(10, 10));
    off.onPointerMove(event(0, 0));
    expect(el.scrollLeft).toBe(100);
    const on = createDragPan(
      () => el,
      () => true,
    );
    on.onPointerDown(event(10, 10, 2));
    on.onPointerMove(event(0, 0));
    expect(el.scrollLeft).toBe(100);
  });
});
