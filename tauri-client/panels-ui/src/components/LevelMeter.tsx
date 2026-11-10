import { barZone, levelToBars } from '../lib/level.js';

const BARS = 8;

/**
 * A small vertical meter, green to amber to red. With the app's own audio engine `level` is the real
 * microphone level (0 to 1); on the platform engine it is 0 or 1 (speaking or not), see AUDIO-SPIKE-RESULTS.md.
 */
export function LevelMeter({ level, dim }: { level: number; dim: boolean }) {
  const lit = levelToBars(level, BARS);
  return (
    <span
      className="vtt-meter"
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={level}
      data-dim={dim}
    >
      {Array.from({ length: BARS }, (_, i) => (
        <i
          key={i}
          className={BARS - i <= lit ? 'vtt-meter-on' : undefined}
          data-zone={barZone(BARS - i, BARS)}
        />
      ))}
    </span>
  );
}
