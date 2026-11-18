import { Avatar } from '@radix-ui/themes';
import type { CharacterRecord } from '@vtt-chat-app/shared';

import { avatarSrc } from '../../lib/account.js';
import { initials } from '../../lib/phone/rail.js';
import { Icon } from '../icons/index.js';

/** A row of portraits, one per character, with a plus to add another: tap one to switch to it. */
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
    <div className="phone-switcher" role="tablist" aria-label="Your characters">
      {characters.map((c) => {
        const src = avatarSrc(c.avatarUrl);
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === shownId}
            className="phone-switch"
            data-playing={c.id === playingId || undefined}
            onClick={() => onChoose(c)}
          >
            <Avatar
              size="4"
              radius="full"
              {...(src ? { src } : {})}
              fallback={initials(c.name)}
              alt=""
            />
            <span>{c.name}</span>
          </button>
        );
      })}
      <button
        type="button"
        role="tab"
        aria-selected={adding}
        className="phone-switch phone-switch-add"
        onClick={onAdd}
      >
        <span className="phone-switch-plus">
          <Icon name="plus" size={20} />
        </span>
        <span>Add</span>
      </button>
    </div>
  );
}
