import { Text } from '@radix-ui/themes';
import { BARD_PERSONAS, type BardId } from '@vtt-chat-app/shared';

import { BardBadge } from './BardBadge.js';

/**
 * The Game Master's choice of who tells this table's tales: one row for each storyteller the server offers (the
 * operator may turn some off), the chosen one marked. Picking one changes it at once.
 */
export function StorytellerPicker({
  offered,
  chosen,
  busy,
  onPick,
}: {
  offered: readonly string[];
  chosen: string;
  busy: boolean;
  onPick: (id: BardId) => void;
}) {
  const options = BARD_PERSONAS.filter((p) => offered.includes(p.id));
  return (
    <div className="phone-bard-picker" role="radiogroup" aria-label="Who tells the tales">
      {options.map((p) => {
        const on = p.id === chosen;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={busy}
            className={`phone-bard-option${on ? ' phone-bard-option-on' : ''}`}
            onClick={() => !on && onPick(p.id)}
          >
            <BardBadge id={p.id} size={36} />
            <span className="phone-bard-text">
              <Text weight="medium">{p.name}</Text>
              <Text size="2" color="gray">
                {p.blurb}
              </Text>
            </span>
          </button>
        );
      })}
    </div>
  );
}
