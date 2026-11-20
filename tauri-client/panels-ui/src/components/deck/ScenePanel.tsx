import { sceneIcon } from '../../lib/sceneIcons.js';
import type { SoundScene } from '../../types/index.js';
import { ToolButton } from '../ToolButton.js';
import { ScenePicker } from './ScenePicker.js';

/**
 * The scenes you chose to show, as icon buttons (the name is the tip). A tap starts a scene (or swaps to
 * it); a tap on the lit one stops it. Right-click hides one; the plus finds, shows or makes others.
 */
export function ScenePanel({
  scenes,
  shown,
  active,
  allSounds,
  onToggle,
  onToggleShown,
  onChanged,
}: {
  scenes: SoundScene[];
  shown: string[];
  active: string | undefined;
  allSounds: { id: string; name: string }[];
  onToggle: (scene: SoundScene, on: boolean) => void;
  onToggleShown: (sceneId: string) => void;
  onChanged: () => void;
}) {
  const visible = shown
    .map((id) => scenes.find((s) => s.id === id))
    .filter((s): s is SoundScene => s !== undefined);
  // A scene started from the picker that is not on the deck stays here, dashed, only while it plays.
  const guest = active && !shown.includes(active) ? scenes.find((s) => s.id === active) : undefined;
  if (guest) visible.push(guest);
  return (
    <div className="vtt-deck-chips" role="group" aria-label="Scenes">
      {visible.map((sc) => {
        const on = active === sc.id;
        const temp = sc === guest;
        const Icon = sceneIcon(sc.name);
        return (
          <ToolButton
            key={sc.id}
            label={
              temp
                ? `Stop ${sc.name} (not on your deck: it leaves when it stops)`
                : on
                  ? `Stop ${sc.name}`
                  : `${sc.name}; right-click to hide`
            }
            pressed={on}
            {...(temp ? { className: 'vtt-tool-temp' } : {})}
            onClick={() => onToggle(sc, !on)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!temp) onToggleShown(sc.id);
            }}
          >
            <Icon size={15} />
          </ToolButton>
        );
      })}
      <ScenePicker
        scenes={scenes}
        shown={shown}
        allSounds={allSounds}
        onStart={(sc) => onToggle(sc, true)}
        onToggleShown={onToggleShown}
        onChanged={onChanged}
      />
    </div>
  );
}
