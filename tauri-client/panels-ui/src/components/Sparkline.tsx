import type { Quality } from '../lib/linkQuality.js';
import { sparklinePoints } from '../lib/sparkline.js';

const W = 84;
const H = 22;

/** A tiny latency trace coloured by the link's current quality (the dot and tooltip say it too, so colour is never the only signal). */
export function Sparkline({ values, quality }: { values: readonly number[]; quality: Quality }) {
  const points = sparklinePoints(values, W, H);
  return (
    <svg
      className={`vtt-spark vtt-spark-${quality}`}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Latency over the last ${values.length} samples`}
    >
      {points && (
        <>
          <polygon points={`0,${H} ${points} ${W},${H}`} className="vtt-spark-fill" />
          <polyline points={points} className="vtt-spark-line" />
        </>
      )}
    </svg>
  );
}
