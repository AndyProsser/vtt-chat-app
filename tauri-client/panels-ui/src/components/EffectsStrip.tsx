import { Clapperboard, Repeat, Square, Volume2 } from 'lucide-react';
import { useState } from 'react';

import { ToolButton } from './ToolButton.js';
import { VoiceStrip } from './VoiceStrip.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { boardIcon, soundIcon } from '../lib/soundIcons.js';
import { accountErrorMessage, syncCommand } from '../lib/tauriBridge.js';
import type { SoundLibrary } from '../types/index.js';

/**
 * The DM's sound effects. The buttons only *ask*; the server picks the take and tells every client
 * (this one included), and each plays it locally in Rust — nothing goes through the voice channel.
 */
const SCENES_TAB = '__scenes__';

export function EffectsStrip() {
  const { data, error } = useCampaignQuery<SoundLibrary>('soundboard/library', []);
  const [master, setMaster] = useState(100);
  const [tab, setTab] = useState<string>();
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
  const boards = data?.boards ?? [];
  const scenes = data?.scenes ?? [];
  const showingScenes = tab === SCENES_TAB;
  const board = showingScenes ? undefined : (boards.find((b) => b.id === tab) ?? boards[0]);
  return (
    <div className="vtt-drawer-body">
      <VoiceStrip />
      <div className="vtt-drawer-row">
        <ToolButton danger label="Stop every sound" onClick={() => void send('sound.stop', {})}>
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
        <span className="vtt-drawer-divider" aria-hidden />
        {boards.map((b) => {
          const Icon = boardIcon(b.name);
          return (
            <ToolButton
              key={b.id}
              label={b.name}
              pressed={board?.id === b.id}
              onClick={() => setTab(b.id)}
            >
              <Icon size={15} />
            </ToolButton>
          );
        })}
        {scenes.length > 0 && (
          <ToolButton label="Scenes" pressed={showingScenes} onClick={() => setTab(SCENES_TAB)}>
            <Clapperboard size={15} />
          </ToolButton>
        )}
      </div>
      {problem && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {problem}
        </div>
      )}
      {showingScenes && (
        <div className="vtt-sound-grid">
          {scenes.map((sc) => (
            <ToolButton
              key={sc.id}
              label={`Start scene: ${sc.name}`}
              text={sc.name}
              onClick={() => void send('scene.start', { sceneId: sc.id })}
            >
              <Clapperboard size={13} />
            </ToolButton>
          ))}
          <ToolButton label="End the scene" onClick={() => void send('scene.stop', {})}>
            <Square size={13} />
          </ToolButton>
        </div>
      )}
      {board && (
        <div className="vtt-sound-grid" aria-label={board.name}>
          {board.buttons.map((btn) => {
            const Icon = soundIcon(btn.label);
            return (
              <ToolButton
                key={btn.id}
                label={`${btn.label}${btn.note ? ` — ${btn.note}` : ''}${btn.mode === 'loop' ? ' (loops)' : ''}`}
                className={btn.mode === 'loop' ? 'vtt-tool-loop' : undefined}
                onClick={() =>
                  void send('sound.play', {
                    soundId: btn.soundId,
                    mode: btn.mode,
                    volume: btn.volume,
                  })
                }
              >
                {btn.mode === 'loop' ? <Repeat size={15} /> : <Icon size={15} />}
              </ToolButton>
            );
          })}
        </div>
      )}
      {data && boards.length === 0 && scenes.length === 0 && (
        <span className="vtt-muted">Your library has no boards or scenes yet.</span>
      )}
    </div>
  );
}
