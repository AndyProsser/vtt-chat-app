import { describe, expect, it, vi } from 'vitest';

import { createHoldPlay, HOLD_MAX_MS, HOLD_MS } from './holdPlay.js';

function setup() {
  vi.useFakeTimers();
  const started: string[] = [];
  const ended: string[] = [];
  let n = 0;
  const hold = createHoldPlay(
    (id) => started.push(id),
    (id) => ended.push(id),
    () => `play-${++n}`,
    {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
  );
  return { hold, started, ended };
}

describe('hold to play', () => {
  it('a quick click starts nothing, so the click plays the stinger once', () => {
    const { hold, started, ended } = setup();
    hold.down();
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(hold.up()).toBe(false);
    vi.advanceTimersByTime(HOLD_MS * 4);
    expect(started).toEqual([]);
    expect(ended).toEqual([]);
    expect(hold.takeClickSuppression()).toBe(false);
  });

  it('holding starts a loop, and letting go stops that loop and swallows the click', () => {
    const { hold, started, ended } = setup();
    hold.down();
    vi.advanceTimersByTime(HOLD_MS);
    expect(started).toEqual(['play-1']);
    expect(hold.up()).toBe(true);
    expect(ended).toEqual(['play-1']);
    expect(hold.takeClickSuppression()).toBe(true);
    expect(hold.takeClickSuppression()).toBe(false);
  });

  it('cuts a hold off after the maximum if the release is never seen', () => {
    const { hold, ended } = setup();
    hold.down();
    vi.advanceTimersByTime(HOLD_MS + HOLD_MAX_MS);
    expect(ended).toEqual(['play-1']);
    expect(hold.up()).toBe(false);
  });
});
