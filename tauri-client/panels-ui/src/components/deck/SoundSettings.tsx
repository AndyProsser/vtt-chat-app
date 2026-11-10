import { Popover, Slider, Tabs, TextField } from '@radix-ui/themes';
import { Plus, SlidersHorizontal, Trash2, Pencil, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { soundIcon } from '../../lib/soundIcons.js';
import type { SoundLevels } from '../../lib/soundLevels.js';
import { searchSounds, type FlatSound } from '../../lib/stingers.js';
import { accountErrorMessage, campaignApi } from '../../lib/tauriBridge.js';
import type { SoundScene } from '../../types/index.js';
import { ToolButton } from '../ToolButton.js';
import { SceneEditor } from './SceneEditor.js';

interface Props {
  sounds: FlatSound[];
  allSounds: { id: string; name: string }[];
  scenes: SoundScene[];
  pins: string[];
  onTogglePin: (soundId: string) => void;
  levels: SoundLevels;
  onLevels: (change: Partial<SoundLevels>) => void;
  onChanged: () => void;
}

/** The cog: volume by kind, favourite stingers, and your scenes (add, change, remove). */
export function SoundSettings(props: Props) {
  return (
    <Popover.Root>
      <Popover.Trigger>
        <ToolButton label="Audio mixer: levels, favourites and scenes">
          <SlidersHorizontal size={15} />
        </ToolButton>
      </Popover.Trigger>
      <Popover.Content
        size="1"
        align="end"
        className="vtt-deck-settings"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Tabs.Root defaultValue="levels">
          <Tabs.List size="1">
            <Tabs.Trigger value="levels">Levels</Tabs.Trigger>
            <Tabs.Trigger value="stingers">Stingers</Tabs.Trigger>
            <Tabs.Trigger value="scenes">Scenes</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="levels">
            <Levels {...props} />
          </Tabs.Content>
          <Tabs.Content value="stingers">
            <Favourites {...props} />
          </Tabs.Content>
          <Tabs.Content value="scenes">
            <Scenes {...props} />
          </Tabs.Content>
        </Tabs.Root>
      </Popover.Content>
    </Popover.Root>
  );
}

function Levels({ levels, onLevels }: Props) {
  const row = (label: string, hint: string, key: keyof SoundLevels) => (
    <div className="vtt-set-row">
      <div className="vtt-set-label">
        <span>{label}</span>
        <small>{hint}</small>
      </div>
      <Slider
        aria-label={`${label} volume`}
        size="1"
        min={0}
        max={100}
        value={[Math.round(levels[key] * 100)]}
        onValueChange={([v]) => onLevels({ [key]: (v ?? 0) / 100 })}
        style={{ width: 130 }}
      />
      <output className="vtt-set-out">{Math.round(levels[key] * 100)}%</output>
    </div>
  );
  return (
    <div className="vtt-set-pane">
      {row('Stingers', 'One-shot sounds', 'stingers')}
      {row('Scenes', 'Loops and random layers', 'scenes')}
      <small className="vtt-muted">
        A sound that is already playing keeps its level; the next one uses the new level.
      </small>
    </div>
  );
}

function Favourites({ sounds, pins, onTogglePin }: Props) {
  const [query, setQuery] = useState('');
  const byId = useMemo(() => new Map(sounds.map((s) => [s.soundId, s])), [sounds]);
  const favs = pins.map((id) => byId.get(id)).filter((s): s is FlatSound => s !== undefined);
  const results = searchSounds(sounds, query)
    .filter((s) => !pins.includes(s.soundId))
    .slice(0, 5);
  const row = (s: FlatSound, add: boolean) => {
    const Icon = soundIcon(s.label, s.board);
    return (
      <div key={s.soundId} className="vtt-set-item">
        <span className="vtt-set-ic">
          <Icon size={15} aria-hidden />
        </span>
        <span className="vtt-set-label">
          <span>{s.label}</span>
          <small>{s.board}</small>
        </span>
        <ToolButton
          label={add ? `Favourite ${s.label}` : `Remove ${s.label} from favourites`}
          danger={!add}
          onClick={() => onTogglePin(s.soundId)}
        >
          {add ? <Plus size={14} /> : <X size={14} />}
        </ToolButton>
      </div>
    );
  };
  return (
    <div className="vtt-set-pane">
      <span className="vtt-set-sub">Favourites</span>
      {favs.length === 0 && <span className="vtt-muted">Nothing favourited yet.</span>}
      {favs.map((s) => row(s, false))}
      <span className="vtt-set-sub">Add a favourite</span>
      <TextField.Root
        size="1"
        aria-label="Find a sound to favourite"
        placeholder="Find a sound"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.map((s) => row(s, true))}
    </div>
  );
}

function Scenes({ allSounds, scenes, onChanged }: Props) {
  const [editing, setEditing] = useState<SoundScene | 'new'>();
  const [error, setError] = useState<string>();
  async function remove(scene: SoundScene) {
    try {
      setError(undefined);
      await campaignApi('DELETE', `soundboard/scenes/${scene.id}`);
      onChanged();
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }
  if (editing) {
    return (
      <SceneEditor
        sounds={allSounds}
        scene={editing === 'new' ? undefined : editing}
        onDone={(saved) => {
          setEditing(undefined);
          if (saved) onChanged();
        }}
      />
    );
  }
  return (
    <div className="vtt-set-pane">
      <div className="vtt-set-head">
        <span className="vtt-set-sub">Your scenes</span>
        <ToolButton label="New scene" text="New" onClick={() => setEditing('new')}>
          <Plus size={14} />
        </ToolButton>
      </div>
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      {scenes.length === 0 && <span className="vtt-muted">No scenes yet.</span>}
      {scenes.map((sc) => (
        <div key={sc.id} className="vtt-set-item">
          <span className="vtt-set-label">
            <span>{sc.name}</span>
            <small>
              {sc.layers.length} {sc.layers.length === 1 ? 'layer' : 'layers'}
            </small>
          </span>
          <ToolButton label={`Edit ${sc.name}`} onClick={() => setEditing(sc)}>
            <Pencil size={14} />
          </ToolButton>
          <ToolButton label={`Delete ${sc.name}`} danger onClick={() => void remove(sc)}>
            <Trash2 size={14} />
          </ToolButton>
        </div>
      ))}
    </div>
  );
}
