import { DropdownMenu } from '@radix-ui/themes';
import { UserPlus } from 'lucide-react';

import { avatarColor } from '../lib/avatarColor.js';
import { playerLines } from '../lib/players.js';
import { initials, memberAvatar } from '../lib/rail.js';
import type { Member } from '../types/index.js';
import { Portrait } from './Portrait.js';
import { ToolButton } from './ToolButton.js';

/**
 * The DM's Give button: a small menu of the campaign's players (avatar, character name, and the
 * player's own name beside it). Picking one gives the item. It floats over the list rather than
 * unfolding inside the row.
 */
export function GivePicker({
  players,
  onPick,
  label,
}: {
  players: Member[];
  onPick: (userId: string) => void;
  label: string;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <ToolButton label={label} className="vtt-tool-wide" disabled={players.length === 0}>
          <UserPlus size={14} />
        </ToolButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="1" align="end">
        <DropdownMenu.Label>Give to</DropdownMenu.Label>
        {players.map((m) => {
          const { primary, secondary } = playerLines(m);
          return (
            <DropdownMenu.Item key={m.userId} onSelect={() => onPick(m.userId)}>
              <span className="vtt-give-row">
                <span className="vtt-av vtt-av-sm" style={{ background: avatarColor(m.userId) }}>
                  <Portrait avatarUrl={memberAvatar(m)} fallback={initials(primary)} size={13} />
                </span>
                <b>{primary}</b>
                {secondary && <span className="vtt-muted">{secondary}</span>}
              </span>
            </DropdownMenu.Item>
          );
        })}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
