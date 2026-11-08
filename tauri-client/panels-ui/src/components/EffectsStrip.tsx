import { Clapperboard, Repeat, Square, Volume2 } from 'lucide-react';
import { useState } from 'react';

import { ToolButton } from './ToolButton.js';
import { VoiceStrip } from './VoiceStrip.js';
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
      <VoiceStrip />
      <div className="vtt-drawer-row">
        <ToolButton
          square
          danger
          label="Stop every sound"
          onClick={() => void send('sound.stop', {})}
        >
          <Square size={14} />
        </ToolButton>
        <label className="vtt-volume" title="Table volume">
          <Volume2 size={15} aria-hidden />
          <input
            type="range"
            aria-label="Table volume"
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
          <Clapperboard size={15} aria-label="Scenes" />
          {data.scenes.map((sc) => (
            <ToolButton
              key={sc.id}
              square
              label={`Start scene: ${sc.name}`}
              text={sc.name}
              onClick={() => void send('scene.start', { sceneId: sc.id })}
            >
              <Clapperboard size={13} />
            </ToolButton>
          ))}
          <ToolButton square label="End the scene" onClick={() => void send('scene.stop', {})}>
            <Square size={13} />
          </ToolButton>
        </div>
      ) : null}
      {data?.boards.map((b) => (
        <div key={b.id} className="vtt-drawer-row" aria-label={b.name}>
          {b.buttons.map((btn) => (
            <ToolButton
              key={btn.id}
              square
              label={`${btn.label}${btn.note ? ` — ${btn.note}` : ''}${btn.mode === 'loop' ? ' (loops)' : ''}`}
              text={btn.label}
              onClick={() =>
                void send('sound.play', {
                  soundId: btn.soundId,
                  mode: btn.mode,
                  volume: btn.volume,
                })
              }
            >
              {btn.mode === 'loop' ? <Repeat size={13} /> : <Volume2 size={13} />}
            </ToolButton>
          ))}
        </div>
      ))}
      {data && data.boards.length === 0 && data.scenes.length === 0 && (
        <span className="vtt-muted">Your library has no boards or scenes yet.</span>
      )}
    </div>
  );
}
