import { Split } from 'lucide-react';
import { useState } from 'react';

import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';
import type { Member } from '../types/index.js';
import { PlayerList } from './PlayerList.js';
import { ToolButton } from './ToolButton.js';

/**
 * Splitting a pile of coin equally (by default among every player, online or not). The inventory and the chat card use the same
 * pieces, so the two cannot disagree: `useCoinSplit` holds the state, `SplitButton` opens it, `SplitFieldset` is the form.
 */
export function useCoinSplit(players: Member[], onDone?: () => void) {
  const [itemId, setItemId] = useState<string>();
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  return {
    itemId,
    chosen,
    setChosen,
    error,
    start: (id: string) => {
      setError(undefined);
      setItemId(id);
      setChosen(players.map((p) => p.userId));
    },
    cancel: () => setItemId(undefined),
    async confirm() {
      try {
        setError(undefined);
        await campaignApi('POST', `loot/${itemId}/split`, { userIds: chosen });
        setItemId(undefined);
        onDone?.();
      } catch (e) {
        setError(accountErrorMessage(e));
      }
    },
  };
}
export type CoinSplit = ReturnType<typeof useCoinSplit>;

export function SplitButton({ onClick }: { onClick: () => void }) {
  return (
    <ToolButton label="Split the coin equally…" onClick={onClick}>
      <Split size={14} />
    </ToolButton>
  );
}

export function SplitFieldset({
  split,
  players,
  item,
}: {
  split: CoinSplit;
  players: Member[];
  item: { name: string; quantity: number };
}) {
  return (
    <fieldset className="vtt-split">
      <legend>
        Split {item.quantity} {item.name} equally among
      </legend>
      <PlayerList
        mode="multi"
        label="Split among"
        players={players}
        selected={split.chosen}
        onChange={split.setChosen}
        hint={(p) => (p.online ? undefined : 'offline')}
      />
      {split.error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {split.error}
        </div>
      )}
      <div className="vtt-drawer-row">
        <ToolButton
          label={`Split among ${split.chosen.length}`}
          disabled={split.chosen.length === 0}
          text={`Split among ${split.chosen.length}`}
          onClick={() => void split.confirm()}
        >
          <Split size={14} />
        </ToolButton>
        <ToolButton label="Cancel" onClick={split.cancel}>
          ×
        </ToolButton>
      </div>
    </fieldset>
  );
}
