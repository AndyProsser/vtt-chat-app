import { Backpack, Hand, Split, Trash2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { itemLabel } from '../lib/timeline.js';
import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';
import type { LootItem } from '../types/index.js';
import { ItemIcon } from './ItemIcon.js';
import { LootWorkbench } from './LootWorkbench.js';
import { ToolButton } from './ToolButton.js';

/**
 * The party inventory: a shared pool. The DM drops items and coin (a roll, the SRD catalog or
 * custom); a player grabs an item for themselves or for the party, and every grab shows who took
 * it. Coin can be split equally (by default among every player, online or not). It does not touch
 * anyone's character sheet.
 */
export function LootPanel() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const players = useMemo(() => members.filter((m) => m.role === 'player'), [members]);
  const { data, error, reload } = useCampaignQuery<{ loot: LootItem[] }>('loot', ['loot.']);
  const [splitting, setSplitting] = useState<string>();
  const [chosen, setChosen] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string>();

  async function run(call: () => Promise<unknown>) {
    try {
      setActionError(undefined);
      await call();
      reload();
    } catch (e) {
      setActionError(accountErrorMessage(e));
    }
  }
  const startSplit = (id: string) => {
    setSplitting(id);
    setChosen(players.map((p) => p.userId)); // default: every player, offline included
  };
  const problem = error ?? actionError;

  return (
    <div className="vtt-inventory">
      <h2 className="vtt-head">
        <Backpack size={18} style={{ verticalAlign: '-3px' }} /> Party inventory
      </h2>
      {problem && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {problem}
        </div>
      )}
      {data?.loot.length === 0 && <p className="vtt-muted">Nothing in the pool yet.</p>}
      {data?.loot.map((item) => {
        const open = !item.claimedBy;
        return (
          <div key={item.id} className={open ? 'vtt-loot' : 'vtt-loot vtt-loot-taken'}>
            <div className="vtt-loot-row">
              <ItemIcon type={item.itemType} rarity={item.rarity} size={22} />
              <div className="vtt-loot-text" style={{ flex: 1 }}>
                <b>{itemLabel(item, members)}</b>
                {item.description && <span className="vtt-muted">{item.description}</span>}
              </div>
              <div className="vtt-drawer-row">
                {open && !dm && (
                  <>
                    <ToolButton
                      label="Take it for yourself"
                      onClick={() =>
                        void run(() =>
                          campaignApi('POST', `loot/${item.id}/claim`, { for: 'self' }),
                        )
                      }
                    >
                      <Hand size={14} />
                    </ToolButton>
                    <ToolButton
                      label="Take it for the party"
                      onClick={() =>
                        void run(() =>
                          campaignApi('POST', `loot/${item.id}/claim`, { for: 'party' }),
                        )
                      }
                    >
                      <Users size={14} />
                    </ToolButton>
                  </>
                )}
                {open && item.kind === 'coin' && (
                  <ToolButton label="Split the coin equally…" onClick={() => startSplit(item.id)}>
                    <Split size={14} />
                  </ToolButton>
                )}
                {dm && (
                  <ToolButton
                    label="Remove it"
                    danger
                    onClick={() => void run(() => campaignApi('DELETE', `loot/${item.id}`))}
                  >
                    <Trash2 size={14} />
                  </ToolButton>
                )}
              </div>
            </div>
            {splitting === item.id && (
              <fieldset className="vtt-split">
                <legend>
                  Split {item.quantity} {item.name} equally among
                </legend>
                {players.map((p) => (
                  <label key={p.userId}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(p.userId)}
                      onChange={(e) =>
                        setChosen((c) =>
                          e.target.checked ? [...c, p.userId] : c.filter((id) => id !== p.userId),
                        )
                      }
                    />
                    {p.character?.name ?? p.displayName}
                    {!p.online && <span className="vtt-muted"> (offline)</span>}
                  </label>
                ))}
                <div className="vtt-drawer-row">
                  <ToolButton
                    label={`Split among ${chosen.length}`}
                    disabled={chosen.length === 0}
                    text={`Split among ${chosen.length}`}
                    onClick={() =>
                      void run(() =>
                        campaignApi('POST', `loot/${item.id}/split`, { userIds: chosen }),
                      ).then(() => setSplitting(undefined))
                    }
                  >
                    <Split size={14} />
                  </ToolButton>
                  <ToolButton label="Cancel" onClick={() => setSplitting(undefined)}>
                    ×
                  </ToolButton>
                </div>
              </fieldset>
            )}
          </div>
        );
      })}
      {dm && <LootWorkbench onDropped={reload} />}
      <p className="vtt-attribution">
        Item names and rules text: System Reference Document 5.1 © Wizards of the Coast LLC,
        CC-BY-4.0.
      </p>
    </div>
  );
}
