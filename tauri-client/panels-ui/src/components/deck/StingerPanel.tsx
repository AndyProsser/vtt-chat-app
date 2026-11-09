import { useMemo } from 'react';

import { soundIcon } from '../../lib/soundIcons.js';
import type { FlatSound } from '../../lib/stingers.js';
import { SoundPicker } from '../SoundPicker.js';
import { ToolButton } from '../ToolButton.js';

/** The favourite one-shots as one-click buttons; the plus finds any other sound. */
export function StingerPanel({
  sounds,
  pins,
  onPlay,
  onTogglePin,
}: {
  sounds: FlatSound[];
  pins: string[];
  onPlay: (sound: FlatSound) => void;
  onTogglePin: (soundId: string) => void;
}) {
  const byId = useMemo(() => new Map(sounds.map((s) => [s.soundId, s])), [sounds]);
  const pinned = pins.map((id) => byId.get(id)).filter((s): s is FlatSound => s !== undefined);
  return (
    <div className="vtt-deck-chips">
      {pinned.map((s) => {
        const Icon = soundIcon(s.label);
        return (
          <ToolButton
            key={s.soundId}
            label={`${s.label} (${s.board}); right-click to unfavourite`}
            onClick={() => onPlay(s)}
            onContextMenu={(e) => {
              e.preventDefault();
              onTogglePin(s.soundId);
            }}
          >
            <Icon size={15} />
          </ToolButton>
        );
      })}
      <SoundPicker sounds={sounds} pinned={pins} onPlay={onPlay} onTogglePin={onTogglePin} />
    </div>
  );
}
