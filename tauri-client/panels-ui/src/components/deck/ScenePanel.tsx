import type { SoundScene } from '../../types/index.js';

/**
 * Scenes in one row that scrolls sideways when there are many. A tap starts a scene (or swaps to it); a
 * tap on the lit one stops it, so there is no separate stop button.
 */
export function ScenePanel({
  scenes,
  active,
  onToggle,
}: {
  scenes: SoundScene[];
  active: string | undefined;
  onToggle: (scene: SoundScene, on: boolean) => void;
}) {
  if (scenes.length === 0) {
    return <span className="vtt-muted">No scenes yet. Make one from the cog.</span>;
  }
  return (
    <div className="vtt-scene-scroll" role="group" aria-label="Scenes">
      {scenes.map((sc) => {
        const on = active === sc.id;
        return (
          <button
            key={sc.id}
            type="button"
            className={on ? 'vtt-scene vtt-scene-on' : 'vtt-scene'}
            aria-pressed={on}
            title={on ? `Stop ${sc.name}` : `Start ${sc.name}`}
            onClick={() => onToggle(sc, !on)}
          >
            {sc.name}
          </button>
        );
      })}
    </div>
  );
}
