import { Popover, TextField } from '@radix-ui/themes';
import { Plus, Search, Star } from 'lucide-react';
import { useState } from 'react';

import { searchSounds, type FlatSound } from '../lib/stingers.js';
import { soundIcon } from '../lib/soundIcons.js';
import { ToolButton } from './ToolButton.js';

/**
 * Find any sound by typing a few letters, then click it to play (Enter plays the first match). The
 * star pins a sound to the deck so it is one click next time.
 */
export function SoundPicker({
  sounds,
  pinned,
  onPlay,
  onTogglePin,
}: {
  sounds: FlatSound[];
  pinned: string[];
  onPlay: (sound: FlatSound) => void;
  onTogglePin: (soundId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const hits = searchSounds(sounds, query);
  return (
    <Popover.Root onOpenChange={(open) => open && setQuery('')}>
      <Popover.Trigger>
        <ToolButton label="Find a sound">
          <Plus size={15} />
        </ToolButton>
      </Popover.Trigger>
      <Popover.Content size="1" width="300px" align="start">
        <div className="vtt-picker">
          <label className="vtt-picker-search">
            <Search size={14} aria-hidden />
            <TextField.Root
              size="1"
              autoFocus
              aria-label="Find a sound"
              placeholder="door, coins, wolf…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hits[0]) onPlay(hits[0]);
              }}
            />
          </label>
          <ul className="vtt-picker-list">
            {hits.length === 0 && <li className="vtt-muted">Nothing matches.</li>}
            {hits.map((s) => {
              const Icon = soundIcon(s.label, s.board);
              const isPinned = pinned.includes(s.soundId);
              return (
                <li key={s.soundId} className="vtt-picker-row">
                  <button type="button" className="vtt-picker-play" onClick={() => onPlay(s)}>
                    <Icon size={14} aria-hidden />
                    <span>{s.label}</span>
                    <span className="vtt-muted">{s.board}</span>
                  </button>
                  <ToolButton
                    label={isPinned ? 'Unpin from the deck' : 'Pin to the deck'}
                    pressed={isPinned}
                    onClick={() => onTogglePin(s.soundId)}
                  >
                    <Star size={13} />
                  </ToolButton>
                </li>
              );
            })}
          </ul>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
