/** The next (+1) or previous (-1) picture, wrapping round the ends. */
export function flip(index: number, count: number, direction: 1 | -1): number {
  if (count <= 1) return 0;
  return (index + direction + count) % count;
}

const MIN_SWIPE_PX = 50;

/** A finished drag as a flip: 1 (forward) for a left swipe, -1 for a right one, 0 for anything else. */
export function swipeOf(dx: number, dy: number): 1 | -1 | 0 {
  if (Math.abs(dx) < MIN_SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
