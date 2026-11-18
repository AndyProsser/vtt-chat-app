import { Clapperboard, Mic, RotateCcw, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { useActiveScene } from '../../hooks/useActiveScene.js';
import { useCampaignQuery } from '../../hooks/useCampaignQuery.js';
import { useDeckPanels } from '../../hooks/useDeckPanels.js';
import { usePins } from '../../hooks/usePins.js';
import { useSoundLevels } from '../../hooks/useSoundLevels.js';
import { VOICES } from '../../lib/commands.js';
import type { PanelName } from '../../lib/deckPanels.js';
import { defaultShownScenes } from '../../lib/scenes.js';
import { defaultPins, flattenSounds, type FlatSound } from '../../lib/stingers.js';
import { accountErrorMessage, syncCommand, voiceEffectSet } from '../../lib/tauriBridge.js';
import type { SoundLibrary } from '../../types/index.js';
import { ToolButton } from '../ToolButton.js';
import { VoiceStrip } from '../VoiceStrip.js';
import { ScenePanel } from './ScenePanel.js';
import { SoundSettings } from './SoundSettings.js';
import { StingerPanel } from './StingerPanel.js';

/**
 * The DM's sound drawer. Its header has a button for each of Voice, Stingers and Scenes (the drawer
 * remembers which were open), then Reset and the cog. Voice is the default; Stingers are favourite
 * one-shots; a Scene is a whole mood started with one tap and stopped by tapping it again.
 */
export function SoundDrawer() {
  const { status } = useAccount();
  const { data, error, reload } = useCampaignQuery<SoundLibrary>('soundboard/library', []);
  const activeScene = useActiveScene();
  const { panels, toggle } = useDeckPanels();
  const { levels, set: setLevels } = useSoundLevels();
  const [actionError, setActionError] = useState<string>();
  const sounds = useMemo(() => flattenSounds(data?.boards ?? []), [data]);
  const fallback = useMemo(() => defaultPins(sounds), [sounds]);
  const { pins, toggle: togglePin } = usePins(status?.campaignId ?? null, fallback);
  const scenes = useMemo(() => data?.scenes ?? [], [data]);
  const sceneFallback = useMemo(() => defaultShownScenes(scenes), [scenes]);
  const { pins: shownScenes, toggle: toggleScene } = usePins(
    status?.campaignId ?? null,
    sceneFallback,
    'scenes',
  );
  // A scene made after the deck first loaded is shown straight away, so "New scene" is one step.
  const knownScenes = useRef<Set<string> | undefined>(undefined);
  useEffect(() => {
    if (!data) return;
    const known = knownScenes.current;
    if (known) {
      for (const sc of scenes)
        if (!known.has(sc.id) && !shownScenes.includes(sc.id)) toggleScene(sc.id);
    }
    knownScenes.current = new Set(scenes.map((s) => s.id));
  }, [data, scenes, shownScenes, toggleScene]);
  const favCount = pins.filter((id) => sounds.some((s) => s.soundId === id)).length;

  async function send(t: string, d: Record<string, unknown>) {
    try {
      setActionError(undefined);
      await syncCommand(t, d);
    } catch (e) {
      setActionError(accountErrorMessage(e));
    }
  }
  const play = (s: FlatSound) =>
    void send('sound.play', { soundId: s.soundId, mode: 'oneshot', volume: s.volume });
  const reset = () => {
    void send('sound.stop', {});
    void voiceEffectSet('normal').catch((e: unknown) => setActionError(accountErrorMessage(e)));
  };

  const header: { name: PanelName; label: string; icon: typeof Mic; count: number | undefined }[] =
    [
      { name: 'voice', label: 'Voice', icon: Mic, count: VOICES.length },
      { name: 'stingers', label: 'Stingers', icon: Zap, count: favCount },
      {
        name: 'scenes',
        label: 'Scenes',
        icon: Clapperboard,
        count: shownScenes.filter((id) => scenes.some((s) => s.id === id)).length,
      },
    ];
  const problem = error ?? actionError;
  return (
    <div className="vtt-deck">
      <div className="vtt-deck-head">
        <span className="vtt-deck-title">Sound</span>
        {header.map(({ name, label, icon: Icon, count }) => (
          <span key={name} className="vtt-count-wrap">
            <ToolButton
              label={`${panels[name] ? 'Hide' : 'Show'} ${label}`}
              pressed={panels[name]}
              onClick={() => toggle(name)}
            >
              <Icon size={15} />
            </ToolButton>
            {!panels[name] && count !== undefined && count > 0 && (
              <span className="vtt-count">{count}</span>
            )}
          </span>
        ))}
        <span className="vtt-deck-sep" aria-hidden />
        <ToolButton
          label="Reset: stop every sound and go back to your own voice"
          danger
          onClick={reset}
        >
          <RotateCcw size={15} />
        </ToolButton>
        <SoundSettings
          sounds={sounds}
          allSounds={data?.sounds ?? []}
          library={data?.sounds ?? []}
          boards={data?.boards ?? []}
          scenes={scenes}
          pins={pins}
          onTogglePin={togglePin}
          levels={levels}
          onLevels={setLevels}
          onChanged={reload}
        />
      </div>
      {problem && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {problem}
        </div>
      )}
      {panels.voice && (
        <div className="vtt-deck-panel">
          <Mic size={15} className="vtt-deck-ic" aria-label="Voice" />
          <VoiceStrip />
        </div>
      )}
      {panels.stingers && (
        <div className="vtt-deck-panel">
          <Zap size={15} className="vtt-deck-ic" aria-label="Stingers" />
          <StingerPanel
            sounds={sounds}
            pins={pins}
            onPlay={play}
            onHoldStart={(s, playId) =>
              void send('sound.play', {
                soundId: s.soundId,
                mode: 'loop',
                playId,
                volume: s.volume,
              })
            }
            onHoldEnd={(playId) => void send('sound.stop', { playId })}
            onTogglePin={togglePin}
          />
        </div>
      )}
      {panels.scenes && (
        <div className="vtt-deck-panel">
          <Clapperboard size={15} className="vtt-deck-ic" aria-label="Scenes" />
          <ScenePanel
            scenes={scenes}
            shown={shownScenes}
            active={activeScene}
            allSounds={data?.sounds ?? []}
            onToggleShown={toggleScene}
            onChanged={reload}
            onToggle={(scene, on) =>
              void send(on ? 'scene.start' : 'scene.stop', on ? { sceneId: scene.id } : {})
            }
          />
        </div>
      )}
    </div>
  );
}
