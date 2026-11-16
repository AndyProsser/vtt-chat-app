import { useEffect, useMemo, useRef } from 'react';

import { createHoldPlay, type HoldPlay } from '../../lib/holdPlay.js';

import { soundIcon } from '../../lib/soundIcons.js';
import type { FlatSound } from '../../lib/stingers.js';
import { SoundPicker } from '../SoundPicker.js';
import { ToolButton } from '../ToolButton.js';

/** The favourite one-shots as one-click buttons; the plus finds any other sound. */
export function StingerPanel({
  sounds,
  pins,
  onPlay,
  onHoldStart,
  onHoldEnd,
  onTogglePin,
}: {
  sounds: FlatSound[];
  pins: string[];
  onPlay: (sound: FlatSound) => void;
  /** A stinger held past a moment loops: start it under `playId`... */
  onHoldStart: (sound: FlatSound, playId: string) => void;
  /** ...and stop exactly that play when the button is let go. */
  onHoldEnd: (playId: string) => void;
  onTogglePin: (soundId: string) => void;
}) {
  const holds = useRef(new Map<string, HoldPlay>());
  // Release is seen on the window, so letting go off the button (or losing focus) still ends the sound.
  useEffect(() => {
    const release = () => holds.current.forEach((h) => h.up());
    window.addEventListener('pointerup', release);
    window.addEventListener('blur', release);
    const all = holds.current;
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('blur', release);
      all.forEach((h) => h.up());
    };
  }, []);
  const holdFor = (s: FlatSound): HoldPlay => {
    let h = holds.current.get(s.soundId);
    if (!h) {
      h = createHoldPlay(
        (playId) => onHoldStart(s, playId),
        (playId) => onHoldEnd(playId),
      );
      holds.current.set(s.soundId, h);
    }
    return h;
  };
  const byId = useMemo(() => new Map(sounds.map((s) => [s.soundId, s])), [sounds]);
  const pinned = pins.map((id) => byId.get(id)).filter((s): s is FlatSound => s !== undefined);
  return (
    <div className="vtt-deck-chips">
      {pinned.map((s) => {
        const Icon = soundIcon(s.label, s.board);
        return (
          <ToolButton
            key={s.soundId}
            label={`${s.label} (${s.board}); hold to keep it playing, right-click to unfavourite`}
            onPointerDown={(e) => e.button === 0 && holdFor(s).down()}
            onPointerCancel={() => holdFor(s).up()}
            onClick={() => {
              if (!holdFor(s).takeClickSuppression()) onPlay(s);
            }}
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
