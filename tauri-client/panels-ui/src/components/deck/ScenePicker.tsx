import { Popover, TextField } from '@radix-ui/themes';
import { Eye, EyeOff, Plus, Search } from 'lucide-react';
import { useState } from 'react';

import { sceneIcon } from '../../lib/sceneIcons.js';
import { searchScenes } from '../../lib/scenes.js';
import type { SoundScene } from '../../types/index.js';
import { ToolButton } from '../ToolButton.js';
import { SceneEditor } from './SceneEditor.js';

/**
 * The plus on the scenes row: find any scene, start it, show or hide it on the deck, or make a new one
 * without leaving the popup. A scene you make is shown on the deck straight away.
 */
export function ScenePicker({
  scenes,
  shown,
  allSounds,
  onStart,
  onToggleShown,
  onChanged,
}: {
  scenes: SoundScene[];
  shown: string[];
  allSounds: { id: string; name: string }[];
  onStart: (scene: SoundScene) => void;
  onToggleShown: (sceneId: string) => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const hits = searchScenes(scenes, query);
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) {
          setQuery('');
          setCreating(false);
        }
      }}
    >
      <Popover.Trigger>
        <ToolButton label="Find or add a scene">
          <Plus size={15} />
        </ToolButton>
      </Popover.Trigger>
      <Popover.Content size="1" width="320px" align="start">
        {creating ? (
          <SceneEditor
            sounds={allSounds}
            scene={undefined}
            onDone={(saved) => {
              setCreating(false);
              if (saved) onChanged();
            }}
          />
        ) : (
          <div className="vtt-picker">
            <div className="vtt-picker-head">
              <label className="vtt-picker-search">
                <Search size={14} aria-hidden />
                <TextField.Root
                  size="1"
                  autoFocus
                  aria-label="Find a scene"
                  placeholder="rain, tavern, cave…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && hits[0]) onStart(hits[0]);
                  }}
                />
              </label>
              <ToolButton label="New scene" onClick={() => setCreating(true)}>
                <Plus size={15} />
              </ToolButton>
            </div>
            <ul className="vtt-picker-list">
              {hits.length === 0 && <li className="vtt-muted">Nothing matches.</li>}
              {hits.map((sc) => {
                const Icon = sceneIcon(sc.name);
                const isShown = shown.includes(sc.id);
                return (
                  <li key={sc.id} className="vtt-picker-row">
                    <button type="button" className="vtt-picker-play" onClick={() => onStart(sc)}>
                      <Icon size={14} aria-hidden />
                      <span>{sc.name}</span>
                    </button>
                    <ToolButton
                      label={
                        isShown ? `Hide ${sc.name} from the deck` : `Show ${sc.name} on the deck`
                      }
                      pressed={isShown}
                      onClick={() => onToggleShown(sc.id)}
                    >
                      {isShown ? <Eye size={13} /> : <EyeOff size={13} />}
                    </ToolButton>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
