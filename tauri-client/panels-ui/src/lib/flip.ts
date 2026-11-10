/** The next slide in a flip panel, wrapping round at both ends. */
export function flip(index: number, count: number, direction: 1 | -1): number {
  if (count <= 1) return 0;
  return (((index + direction) % count) + count) % count;
}
