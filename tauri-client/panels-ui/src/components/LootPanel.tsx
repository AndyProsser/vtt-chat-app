import {
  Backpack,
  Inbox,
  List,
  ListChecks,
  ListTodo,
  Trash2,
  User,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  canConfirm,
  confirmGroup,
  groupForConfirming,
  isConfirmed,
  needsConfirming,
} from '@vtt-chat-app/shared';
import { Fragment, useEffect, useMemo, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { useLeaving } from '../hooks/useLeaving.js';
import {
  defaultFilter,
  filterLoot,
  filtersFor,
  smartLootFilter,
  type LootFilter,
} from '../lib/lootFilter.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { itemLabel } from '../lib/timeline.js';
import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';
import type { LootItem } from '../types/index.js';
import { ItemIcon } from './ItemIcon.js';
import { LootActions } from './LootActions.js';
import { SplitButton, SplitFieldset, useCoinSplit } from './CoinSplit.js';
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
  // Opens where there is something to do (to confirm, else available, else mine), decided once the list and who you are are known,
  // and then left alone: it must not jump while you tick items off.
  const [pickedFilter, setPickedFilter] = useState<LootFilter>();
  const [auto, setAuto] = useState<LootFilter>();
  const ready = data !== undefined && status?.userId != null && members.length > 0;
  useEffect(() => {
    if (auto === undefined && ready) setAuto(smartLootFilter(data.loot, status.userId, dm));
  }, [auto, ready, data, status?.userId, dm]);
  const filter = pickedFilter ?? auto ?? defaultFilter(dm);
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
  const split = useCoinSplit(players, reload);
  const problem = error ?? actionError;
  const view = filtersFor(dm).includes(filter) ? filter : defaultFilter(dm);
  const loot = data?.loot;
  const filtered = useMemo(
    () => filterLoot(loot ?? [], view, status?.userId ?? null),
    [loot, view, status?.userId],
  );
  const order = useMemo(() => (loot ?? []).map((i) => i.id), [loot]);
  const leaving = useLeaving(filtered, order, view);
  // To confirm is grouped: what is mine first, then the party stash, which makes copying to a sheet easier.
  const groups = view === 'unconfirmed' ? groupForConfirming(leaving) : undefined;
  const shown = groups ? [...groups.mine, ...groups.party] : leaving;

  return (
    <div className="vtt-inventory">
      <h2 className="vtt-head vtt-panel-title">
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
              onClick={() => setPickedFilter(f)}
            >
              <Icon size={14} />
            </ToolButton>
          );
        })}
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
      {shown.map((item, index) => {
        const open = !item.claimedBy;
        const head = groups
          ? confirmGroup(item) === 'mine'
            ? index === 0 && { label: 'Mine', items: groups.mine }
            : index === groups.mine.length && { label: 'Party stash', items: groups.party }
          : false;
        const className = [
          'vtt-loot',
          open ? '' : 'vtt-loot-taken',
          item.leaving ? 'vtt-loot-leaving' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <Fragment key={item.id}>
            {head && (
              <div className="vtt-loot-group">
                <h3>
                  {head.label} ({head.items.length})
                </h3>
                <ToolButton
                  className="vtt-tool-wide"
                  label={`Mark all ${head.items.length} in ${head.label} as added to my character sheet`}
                  onClick={() =>
                    void run(async () => {
                      for (const it of head.items)
                        if (!it.leaving && needsConfirming(it, status?.userId ?? null))
                          await campaignApi('POST', `loot/${it.id}/confirm`, { confirmed: true });
                    })
                  }
                >
                  <ListChecks size={14} />
                </ToolButton>
              </div>
            )}
            <div className={className} aria-hidden={item.leaving}>
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
                    <SplitButton onClick={() => split.start(item.id)} />
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
              {split.itemId === item.id && (
                <SplitFieldset split={split} players={players} item={item} />
              )}
            </div>
          </Fragment>
        );
      })}
      <p className="vtt-attribution">
        Item names and rules text: System Reference Document 5.1 © Wizards of the Coast LLC,
        CC-BY-4.0.
      </p>
    </div>
  );
}
