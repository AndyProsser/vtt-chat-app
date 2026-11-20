import { Tooltip } from '@radix-ui/themes';

import { Icon } from '../icons/index.js';

/**
 * "On my sheet": the player's own tick that an item is on their real game sheet (a reminder, nothing more), a small
 * round check box at the right of the item. Loot pages only, never the chat. The tooltip says what it does.
 */
export function ConfirmBox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const label = checked
    ? 'On my character sheet (tap to undo)'
    : 'Mark as added to my character sheet';
  return (
    <Tooltip content={label}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        className={checked ? 'phone-round-check phone-round-check-on' : 'phone-round-check'}
        onClick={() => onChange(!checked)}
      >
        {checked && <Icon name="check" size={14} />}
      </button>
    </Tooltip>
  );
}
