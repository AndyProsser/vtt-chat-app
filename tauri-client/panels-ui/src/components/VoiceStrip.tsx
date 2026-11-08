import { useVoiceEffect } from '../hooks/useVoiceEffect.js';
import { VOICES } from '../lib/commands.js';

/** The DM's character voices. Anything but Normal turns echo cancellation off for you (headphones help). */
export function VoiceStrip() {
  const { current, error, choose } = useVoiceEffect();
  return (
    <div className="vtt-drawer-row">
      <b>Voice</b>
      {VOICES.map((v) => (
        <button
          key={v}
          type="button"
          className={
            v === current ? 'vtt-pill vtt-pill-square vtt-pill-on' : 'vtt-pill vtt-pill-square'
          }
          aria-pressed={v === current}
          onClick={() => void choose(v)}
        >
          {v[0]!.toUpperCase() + v.slice(1)}
        </button>
      ))}
      {current !== 'normal' && (
        <span className="vtt-muted">Echo cancellation is off while you use a character voice.</span>
      )}
      {error && (
        <span className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </span>
      )}
    </div>
  );
}
