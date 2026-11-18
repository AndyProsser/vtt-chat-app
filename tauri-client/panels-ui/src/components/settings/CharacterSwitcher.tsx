import type { CharacterRecord } from '@vtt-chat-app/shared';
import { Plus } from 'lucide-react';

import { Portrait } from '../Portrait.js';

/** A row of portraits, one per character, with a plus to add another: click one to switch to it. */
export function CharacterSwitcher({
  characters,
  shownId,
  playingId,
  adding,
  onChoose,
  onAdd,
}: {
  characters: CharacterRecord[];
  shownId: string | undefined;
  playingId: string | undefined;
  adding: boolean;
  onChoose: (c: CharacterRecord) => void;
  onAdd: () => void;
}) {
  return (
    <div className="vtt-switcher" role="tablist" aria-label="Your characters">
      {characters.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          title={c.id === playingId ? `${c.name} (playing)` : `Play ${c.name}`}
          aria-selected={c.id === shownId}
          className="vtt-switch"
          data-playing={c.id === playingId || undefined}
          onClick={() => onChoose(c)}
        >
          <span className="vtt-av vtt-switch-av">
            <Portrait avatarUrl={c.avatarUrl} fallback={c.name.slice(0, 2).toUpperCase()} />
          </span>
          <span className="vtt-switch-name">{c.name}</span>
        </button>
      ))}
      <button
        type="button"
        role="tab"
        title="Add a character"
        aria-selected={adding}
        className="vtt-switch"
        onClick={onAdd}
      >
        <span className="vtt-switch-plus">
          <Plus size={18} />
        </span>
        <span className="vtt-switch-name">Add</span>
      </button>
    </div>
  );
}
