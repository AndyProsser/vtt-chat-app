import { Select, Slider } from '@radix-ui/themes';
import { Check, Plus, X } from 'lucide-react';
import { useState } from 'react';

import {
  blankScene,
  draftOf,
  newLayer,
  sceneBody,
  validateScene,
  type SceneDraft,
} from '../../lib/sceneDraft.js';
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
  const first = sounds[0]?.id ?? '';
  const [draft, setDraft] = useState<SceneDraft>(() =>
    scene ? draftOf(scene) : blankScene(first),
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const setLayer = (i: number, change: Partial<SceneDraft['layers'][number]>) =>
    setDraft((d) => ({
      ...d,
      layers: d.layers.map((l, j) => (j === i ? { ...l, ...change } : l)),
    }));

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
      <input
        className="vtt-input"
        aria-label="Scene name"
        placeholder="Scene name (an emoji works too)"
        maxLength={120}
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
      />
      <span className="vtt-set-sub">Layers</span>
      {sounds.length === 0 && (
        <span className="vtt-muted">Your library has no sounds yet. Import some first.</span>
      )}
      {draft.layers.map((l, i) => (
        <div key={l.id ?? i} className="vtt-layer">
          <div className="vtt-layer-top">
            <Select.Root value={l.soundId} onValueChange={(v) => setLayer(i, { soundId: v })}>
              <Select.Trigger aria-label="Sound" style={{ flex: 1, minWidth: 0 }} />
              <Select.Content>
                {sounds.map((s) => (
                  <Select.Item key={s.id} value={s.id}>
                    {s.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Select.Root
              value={l.mode}
              onValueChange={(v) =>
                setLayer(
                  i,
                  v === 'loop'
                    ? { mode: 'loop' }
                    : { mode: 'random', ...(l.minIntervalSec === null ? newLayer(l.soundId) : {}) },
                )
              }
            >
              <Select.Trigger aria-label="How it plays" />
              <Select.Content>
                <Select.Item value="loop">Loops</Select.Item>
                <Select.Item value="random">Random</Select.Item>
              </Select.Content>
            </Select.Root>
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
                <input
                  className="vtt-input vtt-num"
                  aria-label="Shortest gap in seconds"
                  inputMode="numeric"
                  value={num(l.minIntervalSec)}
                  onChange={(e) => setLayer(i, { minIntervalSec: toSeconds(e.target.value) })}
                />
                to
                <input
                  className="vtt-input vtt-num"
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
          onClick={() => setDraft({ ...draft, layers: [...draft.layers, newLayer(first)] })}
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
