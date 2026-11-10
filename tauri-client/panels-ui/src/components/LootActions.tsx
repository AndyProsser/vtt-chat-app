import { Hand, Undo2, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';

import { ACTION_LABEL, lootActions, type LootAction } from '../lib/lootActions.js';
import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';
import type { Member } from '../types/index.js';
import { ToolButton } from './ToolButton.js';

const ICON = { take: Hand, store: Users, return: Undo2, give: UserPlus } as const;
const SHORT: Record<LootAction, string> = {
  take: 'Take',
  store: 'Store',
  return: 'Return',
  give: 'Give',
};

/**
 * The buttons that fit one item for one person (see `lootActions`): take or store an item on the table,
 * store or return one you took, and, for the DM, give it to a named player (never to the party). Used by
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
  const [giveOpen, setGiveOpen] = useState(false);
  const [error, setError] = useState<string>();
  const actions = lootActions(item, selfId, dm);
  if (actions.length === 0) return null;

  async function run(call: () => Promise<unknown>) {
    try {
      setError(undefined);
      await call();
      setGiveOpen(false);
      onDone?.();
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }
  const act = (action: LootAction) => {
    if (action === 'give') return setGiveOpen((open) => !open);
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
          const Icon = ICON[action];
          return (
            <ToolButton
              key={action}
              label={ACTION_LABEL[action]}
              text={SHORT[action]}
              pressed={action === 'give' ? giveOpen : undefined}
              onClick={() => act(action)}
            >
              <Icon size={14} />
            </ToolButton>
          );
        })}
      </div>
      {giveOpen && (
        <div className="vtt-form-row" role="group" aria-label="Give to">
          {players.map((p) => (
            <ToolButton
              key={p.userId}
              label={`Give it to ${p.character?.name ?? p.displayName}`}
              text={p.character?.name ?? p.displayName}
              onClick={() =>
                void run(() => campaignApi('POST', `loot/${item.id}/assign`, { userId: p.userId }))
              }
            >
              <UserPlus size={13} />
            </ToolButton>
          ))}
          {players.length === 0 && <span className="vtt-muted">No players yet.</span>}
        </div>
      )}
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </div>
  );
}
