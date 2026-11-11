import { describe, expect, it } from 'vitest';

import {
  CLOSE_DELAY_MS,
  OPEN_DELAY_MS,
  POPOUT_CLOSED,
  type PopoutEvent,
  type PopoutState,
  pendingDelay,
  popoutReducer,
} from './popout.js';

const run = (events: PopoutEvent[], from: PopoutState = POPOUT_CLOSED) =>
  events.reduce(popoutReducer, from);

describe('popout state machine', () => {
  it('opens on hover only after the delay, and not if the mouse leaves first', () => {
    const waiting = run([{ type: 'enter', id: 'a' }]);
    expect(waiting.open).toBeNull();
    expect(pendingDelay(waiting)).toBe(OPEN_DELAY_MS);
    expect(run([{ type: 'timer' }], waiting).open).toBe('a');
    expect(run([{ type: 'leave', id: 'a' }, { type: 'timer' }], waiting)).toEqual(POPOUT_CLOSED);
  });
  it('closes a moment after leaving, and stays if the pointer comes back (e.g. into the popout)', () => {
    const open = run([{ type: 'enter', id: 'a' }, { type: 'timer' }]);
    const leaving = run([{ type: 'leave', id: 'a' }], open);
    expect(pendingDelay(leaving)).toBe(CLOSE_DELAY_MS);
    expect(run([{ type: 'timer' }], leaving).open).toBeNull();
    expect(run([{ type: 'enter', id: 'a' }, { type: 'timer' }], leaving).open).toBe('a');
  });
  it('toggles on click, pinned against mouse leave', () => {
    const open = run([{ type: 'click', id: 'a' }]);
    expect(open).toEqual({ open: 'a', pinned: true, pending: null });
    expect(run([{ type: 'leave', id: 'a' }, { type: 'timer' }], open).open).toBe('a');
    expect(run([{ type: 'click', id: 'a' }], open)).toEqual(POPOUT_CLOSED);
  });
  it('a click on a hover-opened popout pins it rather than closing it', () => {
    const hover = run([{ type: 'enter', id: 'a' }, { type: 'timer' }]);
    expect(run([{ type: 'click', id: 'a' }], hover).pinned).toBe(true);
  });
  it('closes on Escape or an outside press, and clears a waiting change', () => {
    expect(run([{ type: 'dismiss' }], run([{ type: 'click', id: 'a' }]))).toEqual(POPOUT_CLOSED);
    expect(
      run([{ type: 'dismiss' }, { type: 'timer' }], run([{ type: 'enter', id: 'a' }])),
    ).toEqual(POPOUT_CLOSED);
  });
  it('keeps one popout open at a time', () => {
    const a = run([{ type: 'click', id: 'a' }]);
    expect(run([{ type: 'click', id: 'b' }], a).open).toBe('b');
    const hoverA = run([{ type: 'enter', id: 'a' }, { type: 'timer' }]);
    expect(run([{ type: 'enter', id: 'b' }, { type: 'timer' }], hoverA).open).toBe('b');
  });
  it('ignores a timer with nothing pending', () => {
    expect(run([{ type: 'timer' }])).toEqual(POPOUT_CLOSED);
  });
});
