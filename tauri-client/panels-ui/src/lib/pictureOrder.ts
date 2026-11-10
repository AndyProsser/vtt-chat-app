/**
 * The order list the server wants after moving the picture at `index` one place earlier (`-1`) or later
 * (`1`): `order[i]` is the old position of the picture that becomes number `i`. At either end it stays put.
 */
export function moveOrder(count: number, index: number, direction: -1 | 1): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  const to = index + direction;
  if (index < 0 || index >= count || to < 0 || to >= count) return order;
  [order[index], order[to]] = [order[to]!, order[index]!];
  return order;
}
