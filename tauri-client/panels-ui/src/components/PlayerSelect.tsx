import { Popover } from '@radix-ui/themes';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { playerLines } from '../lib/players.js';
import type { Member } from '../types/index.js';
import { PlayerList } from './PlayerList.js';

/**
 * A compact "choose a player" control for a row of other controls: a button showing the choice that
 * opens the same list as everywhere else. `noneLabel` adds a first choice that means nobody (for
 * instance "Pool"), reported as an empty string.
 */
export function PlayerSelect({
  players,
  value,
  onChange,
  label,
  noneLabel,
}: {
  players: Member[];
  value: string;
  onChange: (userId: string) => void;
  label: string;
  noneLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = players.find((p) => p.userId === value);
  const shown = chosen ? playerLines(chosen).primary : (noneLabel ?? 'Choose…');
  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <button type="button" className="vtt-select vtt-select-button" aria-label={label}>
          {shown}
          <ChevronDown size={12} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Content size="1" width="260px" align="start">
        {noneLabel !== undefined && (
          <button type="button" className="vtt-pick-row vtt-pick-none" onClick={() => choose('')}>
            <span className="vtt-pick-names">
              <b>{noneLabel}</b>
            </span>
          </button>
        )}
        <PlayerList mode="pick" label={label} players={players} onPick={choose} />
      </Popover.Content>
    </Popover.Root>
  );
}
