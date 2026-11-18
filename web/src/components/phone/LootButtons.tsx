import { Button } from '@radix-ui/themes';
import type { LootAction } from '@vtt-chat-app/shared';

/** The short label of each loot button (the Loot tab and the chat cards share it). */
export const ACTION_SHORT: Record<LootAction, string> = {
  take: 'Take',
  store: 'Store for party',
  return: 'Put back',
  give: 'Give to…',
};

/** One loot action button. `take` is the solid one. */
export function LootButtons({
  action,
  title,
  onClick,
}: {
  action: LootAction;
  title: string;
  onClick: () => void;
}) {
  return (
    <Button size="1" variant={action === 'take' ? 'solid' : 'soft'} title={title} onClick={onClick}>
      {ACTION_SHORT[action]}
    </Button>
  );
}
