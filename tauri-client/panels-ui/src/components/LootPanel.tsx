import { Backpack, Inbox, List, Split, Trash2, User, UserCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { filterLoot, filtersFor, type LootFilter } from '../lib/lootFilter.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { itemLabel } from '../lib/timeline.js';
import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';
import type { LootItem } from '../types/index.js';
import { ItemIcon } from './ItemIcon.js';
import { LootActions } from './LootActions.js';
import { PlayerList } from './PlayerList.js';
import { LootWorkbench } from './LootWorkbench.js';
import { ToolButton } from './ToolButton.js';

const FILTER_ICON = { all: List, unassigned: Inbox, assigned: UserCheck, mine: User } as const;
const FILTER_LABEL: Record<LootFilter, string> = {
  all: 'Everything',
  unassigned: 'Still in the pool',
  assigned: 'Taken or given out',
  mine: 'Mine',
};

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
  const [filter, setFilter] = useState<LootFilter>('all');
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
  const shown = filterLoot(
    data?.loot ?? [],
    dm && filter === 'mine' ? 'all' : filter,
    status?.userId ?? null,
  );

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
      {dm && <LootWorkbench onDropped={reload} players={players} />}
      <div className="vtt-form-row" role="radiogroup" aria-label="Show">
        {filtersFor(dm).map((f) => {
          const Icon = FILTER_ICON[f];
          return (
            <ToolButton
              key={f}
              label={FILTER_LABEL[f]}
              pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              <Icon size={14} />
            </ToolButton>
          );
        })}
      </div>
      {data && shown.length === 0 && (
        <p className="vtt-muted">
          {data.loot.length === 0 ? 'Nothing in the pool yet.' : 'Nothing matches this filter.'}
        </p>
      )}
      {shown.map((item) => {
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
                <LootActions
                  item={item}
                  selfId={status?.userId ?? null}
                  dm={dm}
                  players={players}
                  onDone={reload}
                />
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
                <PlayerList
                  mode="multi"
                  label="Split among"
                  players={players}
                  selected={chosen}
                  onChange={setChosen}
                  hint={(p) => (p.online ? undefined : 'offline')}
                />
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
      <p className="vtt-attribution">
        Item names and rules text: System Reference Document 5.1 © Wizards of the Coast LLC,
        CC-BY-4.0.
      </p>
    </div>
  );
}
