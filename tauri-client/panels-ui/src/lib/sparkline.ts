/** SVG `points` for a line through `values` (oldest first) inside a `width` × `height` box with `pad` inset vertically. */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2,
): string {
  if (values.length === 0) return '';
  const samples = values.length === 1 ? [values[0]!, values[0]!] : values;
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  const span = hi - lo;
  const inner = height - pad * 2;
  return samples
    .map((v, i) => {
      const x = (i / (samples.length - 1)) * width;
      const y = span === 0 ? height / 2 : pad + inner - ((v - lo) / span) * inner;
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(' ');
}
