/** Items that just left a filtered list, kept a moment so the list can fade them out (useLeaving). */
export type Leaving<T> = ReadonlyMap<string, T>;

/** The leaving set after the list changed from `previous` to `shown`. */
export function trackLeaving<T extends { id: string }>(
  previous: readonly T[],
  shown: readonly T[],
  leaving: Leaving<T>,
): Map<string, T> {
  const now = new Set(shown.map((i) => i.id));
  const next = new Map([...leaving].filter(([id]) => !now.has(id)));
  for (const item of previous) if (!now.has(item.id)) next.set(item.id, item);
  return next;
}

/** The list to draw: what is shown, with the leaving items back in their place (by `order`), marked. */
export function withLeaving<T extends { id: string }>(
  shown: readonly T[],
  leaving: Leaving<T>,
  order: readonly string[],
): (T & { leaving?: true })[] {
  const all: (T & { leaving?: true })[] = [
    ...shown,
    ...[...leaving.values()].map((i) => ({ ...i, leaving: true as const })),
  ];
  const rank = new Map(order.map((id, i) => [id, i]));
  const at = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  return all.sort((x, y) => at(x.id) - at(y.id));
}
