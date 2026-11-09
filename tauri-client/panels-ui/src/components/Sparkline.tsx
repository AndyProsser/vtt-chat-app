import { useId } from 'react';

import type { Quality } from '../lib/linkQuality.js';
import { sparklinePoints } from '../lib/sparkline.js';

const W = 84;
const H = 22;
const COLOUR: Record<Quality, string> = {
  good: '#2eb86c',
  fair: '#e0a12b',
  poor: '#e53935',
  unknown: 'var(--vtt-edge)',
};

/**
 * A tiny latency trace. The line takes the colour the link had at each moment (hard colour stops
 * between samples), so a link that recovers visibly goes red → amber → green. Colour is never the only
 * signal: the dot beside the name and the row tooltip carry the current state in words.
 */
export function Sparkline({
  values,
  qualities,
  quality,
}: {
  values: readonly number[];
  qualities: readonly Quality[];
  quality: Quality;
}) {
  const id = useId();
  const points = sparklinePoints(values, W, H);
  const n = values.length;
  const at = (i: number) => (n <= 1 ? 0 : i / (n - 1));
  const stops = qualities.length === n && n > 0 ? qualities : Array<Quality>(n).fill(quality);
  return (
    <svg
      className="vtt-spark"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Latency over the last ${n} samples`}
    >
      {points && (
        <>
          <defs>
            <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
              {stops.flatMap((q, i) => {
                const from = i === 0 ? 0 : (at(i - 1) + at(i)) / 2;
                const to = i === n - 1 ? 1 : (at(i) + at(i + 1)) / 2;
                return [
                  <stop key={`${i}a`} offset={from} stopColor={COLOUR[q]} />,
                  <stop key={`${i}b`} offset={to} stopColor={COLOUR[q]} />,
                ];
              })}
            </linearGradient>
          </defs>
          <polygon points={`0,${H} ${points} ${W},${H}`} fill={`url(#${id})`} opacity={0.2} />
          <polyline
            points={points}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
