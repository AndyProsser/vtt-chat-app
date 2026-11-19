import { Icon } from '../icons/index.js';
import { IconTool } from './IconTool.js';

/**
 * "On my sheet": the player's own tick that an item is on their real game sheet (a reminder, nothing more), as an
 * icon toggle like the rest of the app's controls; the tooltip says what it does.
 */
export function ConfirmBox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <IconTool
      label={
        checked ? 'On my character sheet (tap to undo)' : 'Mark as added to my character sheet'
      }
      icon="clipboardCheck"
      pressed={checked}
      onClick={() => onChange(!checked)}
    />
  );
}
