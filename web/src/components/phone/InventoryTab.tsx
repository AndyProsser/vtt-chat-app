import { Badge, Callout, Card, Flex, SegmentedControl, Text } from '@radix-ui/themes';
import {
  confirmGroup,
  groupForConfirming,
  canConfirm,
  defaultLootFilter,
  isConfirmed,
  filterLootItems,
  lootActions,
  lootFiltersFor,
  lootRequest,
  needsConfirming,
  type LootAction,
  type LootFilter,
} from '@vtt-chat-app/shared';
import { Fragment, useState } from 'react';

import { holder } from '../../lib/phone/lootCards.js';
import { GiveSelect } from './GiveSelect.js';
import { LootButtons } from './LootButtons.js';

import { useIsDm } from '../../hooks/useIsDm.js';
import { useLoad } from '../../hooks/useLoad.js';
import { ApiError } from '../../lib/api.js';
import { lootConfirm, lootDo, lootItems } from '../../lib/phone/phoneApi.js';
import { ConfirmBox } from './ConfirmBox.js';
import { IconTool } from './IconTool.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import type { LootItem } from '../../types/phone.js';

const FILTER_LABEL: Record<LootFilter, string> = {
  available: 'Available',
  taken: 'Taken',
  all: 'All',
  own: 'Mine',
  party: 'Party',
  unconfirmed: 'To confirm',
};
const RARITY_COLOR: Record<string, 'gray' | 'green' | 'blue' | 'violet' | 'orange' | 'red'> = {
  common: 'gray',
  uncommon: 'green',
  rare: 'blue',
  'very rare': 'violet',
  legendary: 'orange',
  artifact: 'red',
};

/** The party's loot: what the DM has dropped and who has it. Players take, stash and return; the DM gives items to a player. */
export function InventoryTab({ campaignId }: { campaignId: string }) {
  const rev = usePhoneStore((s) => s.lootRev);
  const members = usePhoneStore((s) => s.members);
  const selfId = usePhoneStore((s) => s.userId) ?? null;
  const dm = useIsDm(campaignId);
  const { data, error, loading, reload } = useLoad(
    () => lootItems(campaignId),
    `${campaignId}:${rev}`,
  );
  const [filter, setFilter] = useState<LootFilter>(() => defaultLootFilter(dm));
  const [problem, setProblem] = useState<string>();
  const filters = lootFiltersFor(dm);
  const view = filters.includes(filter) ? filter : defaultLootFilter(dm);
  const filtered = filterLootItems(data ?? [], view, selfId);
  // To confirm is grouped: what is mine first, then the party stash, which makes copying to a sheet easier.
  const groups = view === 'unconfirmed' ? groupForConfirming(filtered) : undefined;
  const shown = groups ? [...groups.mine, ...groups.party] : filtered;
  const players = members.filter((m) => m.role !== 'dm');

  async function run(item: LootItem, action: LootAction, userId?: string) {
    setProblem(undefined);
    try {
      const req =
        action === 'give' ? lootRequest('give', item, userId ?? '') : lootRequest(action, item);
      await lootDo(campaignId, item.id, req);
      reload();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'That did not work. Try again.');
    }
  }

  /** Ticks every item of a group that is not on the player's sheet yet, one after another. */
  async function confirmAll(group: LootItem[]) {
    setProblem(undefined);
    try {
      for (const item of group.filter((i) => needsConfirming(i, selfId)))
        await lootConfirm(campaignId, item.id, true);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'That did not work. Try again.');
    }
    reload();
  }

  async function confirm(item: LootItem, value: boolean) {
    setProblem(undefined);
    try {
      await lootConfirm(campaignId, item.id, value);
      reload();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'That did not work. Try again.');
    }
  }

  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <Flex align="center" justify="between" gap="2" wrap="wrap">
        <SegmentedControl.Root
          size="1"
          value={view}
          onValueChange={(v) => setFilter(v as LootFilter)}
        >
          {filters.map((f) => (
            <SegmentedControl.Item key={f} value={f}>
              {FILTER_LABEL[f]}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
      </Flex>
      {(error || problem) && (
        <Callout.Root color="red">
          <Callout.Text>{error ?? problem}</Callout.Text>
        </Callout.Root>
      )}
      {loading && !data && <Text color="gray">Loading…</Text>}
      {data && shown.length === 0 && (
        <Text color="gray" align="center" mt="6">
          {data.length === 0
            ? 'Nothing here yet. Loot the DM drops shows up here.'
            : view === 'available'
              ? 'Nothing left to take.'
              : view === 'unconfirmed'
                ? 'Everything you hold is on your sheet. Look under Available for what is left to take.'
                : 'Nothing in this list.'}
        </Text>
      )}
      {shown.map((item, index) => {
        const actions = lootActions(item, selfId, dm);
        const onSheet = isConfirmed(item, selfId);
        const head = groups
          ? confirmGroup(item) === 'mine'
            ? index === 0 && { label: 'Mine', items: groups.mine }
            : index === groups.mine.length && { label: 'Party stash', items: groups.party }
          : false;
        return (
          <Fragment key={item.id}>
            {head && (
              <Flex align="center" justify="between" className="phone-group-head">
                <Text size="2" weight="bold" color="gray">
                  {head.label} ({head.items.length})
                </Text>
                <IconTool
                  small
                  label={`Mark all ${head.items.length} in ${head.label} as added to my character sheet`}
                  icon="listChecks"
                  onClick={() => void confirmAll(head.items)}
                />
              </Flex>
            )}
            <Card size="2">
              <Flex direction="column" gap="2">
                <Flex gap="2" align="start" justify="between">
                  <Flex gap="2" align="center" wrap="wrap" style={{ minWidth: 0 }}>
                    <Text weight="medium">
                      {item.kind === 'coin'
                        ? `${item.quantity} ${item.name}`
                        : `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`}
                    </Text>
                    {item.rarity && (
                      <Badge color={RARITY_COLOR[item.rarity] ?? 'gray'}>{item.rarity}</Badge>
                    )}
                    <Badge variant="soft" color="gray">
                      {item.itemType}
                    </Badge>
                  </Flex>
                  <Flex gap="2" align="center" justify="end" style={{ flex: 'none' }}>
                    {actions.map((action) =>
                      action === 'give' ? (
                        <GiveSelect
                          key={action}
                          players={players}
                          onPick={(userId) => void run(item, 'give', userId)}
                        />
                      ) : (
                        <LootButtons
                          key={action}
                          action={action}
                          // On the player's sheet it stays put: untick it first to move it.
                          disabled={onSheet}
                          onClick={() => void run(item, action)}
                        />
                      ),
                    )}
                    {canConfirm(item, selfId, dm) && (
                      <ConfirmBox checked={onSheet} onChange={(v) => void confirm(item, v)} />
                    )}
                  </Flex>
                </Flex>
                {item.description && (
                  <Text size="2" color="gray">
                    {item.description}
                  </Text>
                )}
                <Text size="1" color={item.claimedBy ? 'violet' : 'green'}>
                  {holder(item, members)}
                </Text>
              </Flex>
            </Card>
          </Fragment>
        );
      })}
    </Flex>
  );
}
