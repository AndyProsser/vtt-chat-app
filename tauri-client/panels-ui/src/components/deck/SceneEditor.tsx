import { Select, Slider, TextField } from '@radix-ui/themes';
import { Check, Plus, Repeat, Shuffle, X } from 'lucide-react';
import { useState } from 'react';

import {
  blankScene,
  draftOf,
  newLayer,
  sceneBody,
  validateScene,
  type SceneDraft,
} from '../../lib/sceneDraft.js';
import { soundsFor } from '../../lib/sceneSounds.js';
import { accountErrorMessage, campaignApi } from '../../lib/tauriBridge.js';
import type { SoundScene } from '../../types/index.js';
import { ToolButton } from '../ToolButton.js';

/**
 * One scene: a name and its layers. A loop plays the whole time the scene is on; a random layer drops its
 * sound in now and then, somewhere between the shortest and longest gap.
 */
export function SceneEditor({
  sounds,
  scene,
  onDone,
}: {
  sounds: { id: string; name: string }[];
  scene: SoundScene | undefined;
  onDone: (saved: boolean) => void;
}) {
  const firstEffect = soundsFor('random', sounds)[0]?.id ?? '';
  const firstLoop = soundsFor('loop', sounds)[0]?.id ?? '';
  const [draft, setDraft] = useState<SceneDraft>(() =>
    scene
      ? draftOf(scene)
      : firstLoop
        ? blankScene(firstLoop)
        : { name: '', layers: [newLayer(firstEffect)] },
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const setLayer = (i: number, change: Partial<SceneDraft['layers'][number]>) =>
    setDraft((d) => ({
      ...d,
      layers: d.layers.map((l, j) => (j === i ? { ...l, ...change } : l)),
    }));

  /** Switching a layer's mode changes which sounds fit: keep the sound if it still fits, else take the first that does. */
  function switchMode(i: number, mode: 'loop' | 'random') {
    const layer = draft.layers[i];
    if (!layer) return;
    const fits = soundsFor(mode, sounds);
    const soundId = fits.some((s) => s.id === layer.soundId) ? layer.soundId : (fits[0]?.id ?? '');
    setLayer(
      i,
      mode === 'loop'
        ? { mode, soundId }
        : {
            mode,
            soundId,
            ...(layer.minIntervalSec === null ? { minIntervalSec: 8, maxIntervalSec: 20 } : {}),
          },
    );
  }

  async function save() {
    const problem = validateScene(draft);
    if (problem) return setError(problem);
    try {
      setBusy(true);
      setError(undefined);
      const body = sceneBody(draft);
      if (draft.id) await campaignApi('PUT', `soundboard/scenes/${draft.id}`, body);
      else await campaignApi('POST', 'soundboard/scenes', body);
      onDone(true);
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const num = (v: number | null) => (v === null ? '' : String(v));
  return (
    <div className="vtt-set-pane">
      <TextField.Root
        size="1"
        aria-label="Scene name"
        placeholder="Scene name (an emoji works too)"
        maxLength={120}
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
      />
      <span className="vtt-set-sub">Layers</span>
      {firstLoop === '' && sounds.length > 0 && (
        <span className="vtt-muted">
          You have no ambience or music sounds, so loops are not available yet. Random layers use
          your effects.
        </span>
      )}
      {sounds.length === 0 && (
        <span className="vtt-muted">Your library has no sounds yet. Import some first.</span>
      )}
      {draft.layers.map((l, i) => (
        <div key={l.id ?? i} className="vtt-layer">
          <div className="vtt-layer-top">
            <Select.Root value={l.soundId} onValueChange={(v) => setLayer(i, { soundId: v })}>
              <Select.Trigger
                aria-label="Sound"
                placeholder={l.mode === 'loop' ? 'Pick ambience or music' : 'Pick an effect'}
                style={{ flex: 1, minWidth: 0 }}
              />
              <Select.Content position="popper" sideOffset={4} className="vtt-dropdown">
                {soundsFor(l.mode, sounds).map((s) => (
                  <Select.Item key={s.id} value={s.id}>
                    {s.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <ToolButton
              label={
                l.mode === 'loop'
                  ? 'Plays all the time. Click for random.'
                  : 'Plays now and then. Click for a loop.'
              }
              pressed={l.mode === 'loop'}
              onClick={() => switchMode(i, l.mode === 'loop' ? 'random' : 'loop')}
            >
              {l.mode === 'loop' ? <Repeat size={14} /> : <Shuffle size={14} />}
            </ToolButton>
            <ToolButton
              label="Remove this layer"
              danger
              onClick={() => setDraft({ ...draft, layers: draft.layers.filter((_, j) => j !== i) })}
            >
              <X size={14} />
            </ToolButton>
          </div>
          <div className="vtt-layer-bottom">
            <Slider
              aria-label="Layer volume"
              size="1"
              min={0}
              max={100}
              value={[Math.round(l.volume * 100)]}
              onValueChange={([v]) => setLayer(i, { volume: (v ?? 0) / 100 })}
              style={{ width: 110 }}
            />
            {l.mode === 'random' && (
              <span className="vtt-gap">
                every
                <TextField.Root
                  size="1"
                  className="vtt-num"
                  aria-label="Shortest gap in seconds"
                  inputMode="numeric"
                  value={num(l.minIntervalSec)}
                  onChange={(e) => setLayer(i, { minIntervalSec: toSeconds(e.target.value) })}
                />
                to
                <TextField.Root
                  size="1"
                  className="vtt-num"
                  aria-label="Longest gap in seconds"
                  inputMode="numeric"
                  value={num(l.maxIntervalSec)}
                  onChange={(e) => setLayer(i, { maxIntervalSec: toSeconds(e.target.value) })}
                />
                s
              </span>
            )}
          </div>
        </div>
      ))}
      <div>
        <ToolButton
          label="Add a layer"
          text="Layer"
          disabled={sounds.length === 0}
          onClick={() => setDraft({ ...draft, layers: [...draft.layers, newLayer(firstEffect)] })}
        >
          <Plus size={14} />
        </ToolButton>
      </div>
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      <div className="vtt-set-foot">
        <ToolButton label="Cancel" onClick={() => onDone(false)}>
          <X size={14} />
        </ToolButton>
        <ToolButton label="Save the scene" disabled={busy} onClick={() => void save()}>
          <Check size={14} />
        </ToolButton>
      </div>
    </div>
  );
}

function toSeconds(text: string): number | null {
  const n = Number(text.replace(/\D/g, ''));
  return text.trim() === '' || !Number.isFinite(n) ? null : n;
}
