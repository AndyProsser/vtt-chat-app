import { Tooltip } from '@radix-ui/themes';
import { Check } from 'lucide-react';

/**
 * "On my sheet": the player's own tick that an item is on their real game sheet (a reminder, nothing more), a small
 * round check box at the right of the item. Party inventory only, never the chat. The tooltip says what it does.
 */
export function RoundCheck({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const label = checked
    ? 'On my character sheet (click to undo)'
    : 'Mark as added to my character sheet';
  return (
    <Tooltip content={label}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        className={checked ? 'vtt-round-check vtt-round-check-on' : 'vtt-round-check'}
        onClick={() => onChange(!checked)}
      >
        {checked && <Check size={12} aria-hidden />}
      </button>
    </Tooltip>
  );
}
