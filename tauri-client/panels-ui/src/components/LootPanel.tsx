import {
  Backpack,
  Inbox,
  List,
  ListChecks,
  ListTodo,
  Split,
  Trash2,
  User,
  UserCheck,
  Users,
} from 'lucide-react';
import { canConfirm, isConfirmed, needsConfirming } from '@vtt-chat-app/shared';
import { useMemo, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { useLeaving } from '../hooks/useLeaving.js';
import { defaultFilter, filterLoot, filtersFor, type LootFilter } from '../lib/lootFilter.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { itemLabel } from '../lib/timeline.js';
import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';
import type { LootItem } from '../types/index.js';
import { ItemIcon } from './ItemIcon.js';
import { LootActions } from './LootActions.js';
import { PlayerList } from './PlayerList.js';
import { LootWorkbench } from './LootWorkbench.js';
import { RoundCheck } from './RoundCheck.js';
import { ToolButton } from './ToolButton.js';
import { EmptyState } from './EmptyState.js';

const FILTER_ICON = {
  available: Inbox,
  taken: UserCheck,
  all: List,
  own: User,
  party: Users,
  unconfirmed: ListTodo,
} as const;
const FILTER_LABEL: Record<LootFilter, string> = {
  available: 'Available',
  taken: 'Taken',
  all: 'All',
  own: 'Mine',
  party: 'Party stash',
  unconfirmed: 'Not added to my sheet yet',
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
  const [filter, setFilter] = useState<LootFilter>(() => defaultFilter(dm));
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
  const view = filtersFor(dm).includes(filter) ? filter : defaultFilter(dm);
  const loot = data?.loot;
  const filtered = useMemo(
    () => filterLoot(loot ?? [], view, status?.userId ?? null),
    [loot, view, status?.userId],
  );
  const order = useMemo(() => (loot ?? []).map((i) => i.id), [loot]);
  const shown = useLeaving(filtered, order, view);
  // What the "Add all" button would tick: this player's own items in the list that are not on their sheet yet.
  const pending = shown.filter((i) => !i.leaving && needsConfirming(i, status?.userId ?? null));

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
              pressed={view === f}
              onClick={() => setFilter(f)}
            >
              <Icon size={14} />
            </ToolButton>
          );
        })}
        {pending.length > 0 && (
          <>
            <span className="vtt-spacer" />
            <ToolButton
              className="vtt-tool-wide"
              label={`Mark all ${pending.length} as added to my character sheet`}
              onClick={() =>
                void run(async () => {
                  for (const item of pending)
                    await campaignApi('POST', `loot/${item.id}/confirm`, { confirmed: true });
                })
              }
            >
              <ListChecks size={14} />
            </ToolButton>
          </>
        )}
      </div>
      {data &&
        shown.length === 0 &&
        (data.loot.length === 0 ? (
          <EmptyState>Nothing in the pool yet.</EmptyState>
        ) : view === 'available' ? (
          <p className="vtt-muted">Nothing left to take.</p>
        ) : view === 'unconfirmed' ? (
          <p className="vtt-muted">
            Everything you hold is on your sheet. Look under Available for what is left to take.
          </p>
        ) : (
          <p className="vtt-muted">Nothing matches this filter.</p>
        ))}
      {shown.map((item) => {
        const open = !item.claimedBy;
        const className = [
          'vtt-loot',
          open ? '' : 'vtt-loot-taken',
          item.leaving ? 'vtt-loot-leaving' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div key={item.id} className={className} aria-hidden={item.leaving}>
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
                  disabled={isConfirmed(item, status?.userId ?? null)}
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
                {canConfirm(item, status?.userId ?? null, dm) && (
                  <RoundCheck
                    checked={isConfirmed(item, status?.userId ?? null)}
                    onChange={(v) =>
                      void run(() =>
                        campaignApi('POST', `loot/${item.id}/confirm`, { confirmed: v }),
                      )
                    }
                  />
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
