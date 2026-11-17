import { Select } from '@radix-ui/themes';

import { initials, playerLines, portraitUrl } from '../../lib/phone/rail.js';
import type { Member } from '../../types/phone.js';

/**
 * The DM's Give control: one tap opens the list of players (portrait, character name, the player's own
 * name beside it); picking one gives the item. It always reads "Give to…", so it is ready for the next item.
 */
export function GiveSelect({
  players,
  onPick,
}: {
  players: Member[];
  onPick: (userId: string) => void;
}) {
  return (
    <Select.Root size="1" value="" onValueChange={onPick} disabled={players.length === 0}>
      <Select.Trigger placeholder="Give to…" />
      <Select.Content position="popper">
        {players.map((m) => {
          const { primary, secondary } = playerLines(m);
          const pic = portraitUrl(m);
          return (
            <Select.Item key={m.userId} value={m.userId}>
              <span className="phone-give-row">
                <span className="phone-give-avatar" aria-hidden="true">
                  {pic ? <img src={pic} alt="" /> : initials(primary)}
                </span>
                <span>{primary}</span>
                {secondary && <span className="phone-give-secondary">{secondary}</span>}
              </span>
            </Select.Item>
          );
        })}
      </Select.Content>
    </Select.Root>
  );
}
