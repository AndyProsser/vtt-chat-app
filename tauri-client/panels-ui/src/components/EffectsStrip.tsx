import { useState } from 'react';

import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { accountErrorMessage, syncCommand } from '../lib/tauriBridge.js';
import type { SoundLibrary } from '../types/index.js';

/**
 * The DM's sound effects. The buttons only *ask*; the server picks the take and tells every client
 * (this one included), and each plays it locally in Rust — nothing goes through the voice channel.
 */
export function EffectsStrip() {
  const { data, error } = useCampaignQuery<SoundLibrary>('soundboard/library', []);
  const [master, setMaster] = useState(100);
  const [actionError, setActionError] = useState<string>();

  async function send(t: string, d: Record<string, unknown>) {
    try {
      setActionError(undefined);
      await syncCommand(t, d);
    } catch (e) {
      setActionError(accountErrorMessage(e));
    }
  }

  const problem = error ?? actionError;
  return (
    <div className="vtt-drawer-body">
      <div className="vtt-drawer-row">
        <button
          type="button"
          className="vtt-pill vtt-pill-square"
          onClick={() => void send('sound.stop', {})}
        >
          ■ Stop all
        </button>
        <label className="vtt-volume">
          Volume
          <input
            type="range"
            min={0}
            max={100}
            value={master}
            onChange={(e) => setMaster(Number(e.target.value))}
            onPointerUp={() => void send('sound.volume', { master: master / 100 })}
            onKeyUp={() => void send('sound.volume', { master: master / 100 })}
          />
        </label>
      </div>
      {problem && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {problem}
        </div>
      )}
      {data?.scenes.length ? (
        <div className="vtt-drawer-row">
          <b>Scenes</b>
          {data.scenes.map((s) => (
            <span key={s.id} className="vtt-pill-group">
              <button
                type="button"
                className="vtt-pill vtt-pill-square"
                onClick={() => void send('scene.start', { sceneId: s.id })}
              >
                {s.name}
              </button>
            </span>
          ))}
          <button
            type="button"
            className="vtt-pill vtt-pill-square"
            onClick={() => void send('scene.stop', {})}
          >
            End scene
          </button>
        </div>
      ) : null}
      {data?.boards.map((b) => (
        <div key={b.id} className="vtt-drawer-row">
          <b>{b.name}</b>
          {b.buttons.map((btn) => (
            <button
              key={btn.id}
              type="button"
              className="vtt-pill vtt-pill-square"
              title={btn.note || undefined}
              onClick={() =>
                void send('sound.play', {
                  soundId: btn.soundId,
                  mode: btn.mode,
                  volume: btn.volume,
                })
              }
            >
              {btn.mode === 'loop' ? '↻ ' : ''}
              {btn.label}
            </button>
          ))}
        </div>
      ))}
      {data && data.boards.length === 0 && data.scenes.length === 0 && (
        <span className="vtt-muted">Your library has no boards or scenes yet.</span>
      )}
    </div>
  );
}
