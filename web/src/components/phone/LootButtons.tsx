import { LOOT_ACTION_LABEL, type LootAction } from '@vtt-chat-app/shared';

import type { IconName } from '../icons/paths.js';
import { IconTool } from './IconTool.js';

/** One icon per loot action: the Loot tab and the chat cards share them, and the tooltip says what each does. */
export const ACTION_ICON: Record<Exclude<LootAction, 'give'>, IconName> = {
  take: 'hand',
  store: 'users',
  return: 'undo2',
  redrop: 'megaphone',
};

/** One loot action as an icon button with a tip. `disabled` greys it out (an item on the player's sheet stays put). */
export function LootButtons({
  action,
  onClick,
  disabled,
}: {
  action: Exclude<LootAction, 'give'>;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <IconTool
      label={LOOT_ACTION_LABEL[action]}
      icon={ACTION_ICON[action]}
      {...(disabled ? { disabled: true } : {})}
      onClick={onClick}
    />
  );
}
