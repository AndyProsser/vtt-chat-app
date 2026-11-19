import { DropdownMenu } from '@radix-ui/themes';

import { initials, playerLines, portraitUrl } from '../../lib/phone/rail.js';
import type { Member } from '../../types/phone.js';
import { IconTool } from './IconTool.js';

/**
 * The DM's Give control: a gift icon that opens the list of players (portrait, character name, the player's own
 * name beside it); picking one gives the item.
 */
export function GiveSelect({
  players,
  onPick,
}: {
  players: Member[];
  onPick: (userId: string) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger disabled={players.length === 0}>
        <IconTool label="Give it to a player…" icon="gift" disabled={players.length === 0} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="1" align="end">
        {players.map((m) => {
          const { primary, secondary } = playerLines(m);
          const pic = portraitUrl(m);
          return (
            <DropdownMenu.Item key={m.userId} onSelect={() => onPick(m.userId)}>
              <span className="phone-give-row">
                <span className="phone-give-avatar" aria-hidden="true">
                  {pic ? <img src={pic} alt="" /> : initials(primary)}
                </span>
                <span>{primary}</span>
                {secondary && <span className="phone-give-secondary">{secondary}</span>}
              </span>
            </DropdownMenu.Item>
          );
        })}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
