/**
 * The drop target under the pointer: the `data-lane` of the topmost element that has one
 * (`main`, a party id, or `new`). Pointer-driven dragging reads this from `elementsFromPoint`.
 */
export function laneAt(elements: readonly Element[]): string | undefined {
  for (const element of elements) {
    const lane = (element as HTMLElement).dataset?.lane;
    if (lane !== undefined) return lane;
  }
  return undefined;
}
