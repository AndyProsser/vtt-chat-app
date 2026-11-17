import { Hand, Undo2, Users } from 'lucide-react';
import { useState } from 'react';

import { ACTION_LABEL, lootActions, type LootAction } from '../lib/lootActions.js';
import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';
import type { Member } from '../types/index.js';
import { GivePicker } from './GivePicker.js';
import { ToolButton } from './ToolButton.js';

const ICON = { take: Hand, store: Users, return: Undo2 } as const;
const SHORT: Record<LootAction, string> = {
  take: 'Take',
  store: 'Store',
  return: 'Return',
  give: 'Give',
};

/**
 * The buttons that fit one item for one person (see `lootActions`): take or store an item on the table,
 * store or return one you took, take or return a party-stash item, and, for the DM, give it to a named
 * player from a menu (never to the party). Used by
 * the chat card and by the inventory window, so the two cannot disagree.
 */
export function LootActions({
  item,
  selfId,
  dm,
  players,
  onDone,
}: {
  item: {
    id: string;
    claimedBy?: string | null;
    claimedFor?: Parameters<typeof lootActions>[0]['claimedFor'];
  };
  selfId: string | null;
  dm: boolean;
  players: Member[];
  onDone?: () => void;
}) {
  const [error, setError] = useState<string>();
  const actions = lootActions(item, selfId, dm);
  if (actions.length === 0) return null;

  async function run(call: () => Promise<unknown>) {
    try {
      setError(undefined);
      await call();
      onDone?.();
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }
  const act = (action: Exclude<LootAction, 'give'>) => {
    const call =
      action === 'take'
        ? () => campaignApi('POST', `loot/${item.id}/claim`, { for: 'self' })
        : action === 'store' && !item.claimedBy
          ? () => campaignApi('POST', `loot/${item.id}/claim`, { for: 'party' })
          : () => campaignApi('POST', `loot/${item.id}/${action}`, {});
    void run(call);
  };

  return (
    <div className="vtt-loot-actions">
      <div className="vtt-form-row">
        {actions.map((action) => {
          if (action === 'give') {
            return (
              <GivePicker
                key={action}
                label={ACTION_LABEL.give}
                players={players}
                onPick={(userId) =>
                  void run(() => campaignApi('POST', `loot/${item.id}/assign`, { userId }))
                }
              />
            );
          }
          const Icon = ICON[action];
          return (
            <ToolButton
              key={action}
              label={ACTION_LABEL[action]}
              text={SHORT[action]}
              onClick={() => act(action)}
            >
              <Icon size={14} />
            </ToolButton>
          );
        })}
      </div>
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </div>
  );
}
