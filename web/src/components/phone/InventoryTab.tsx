import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  SegmentedControl,
  Select,
  Text,
} from '@radix-ui/themes';
import {
  filterLootItems,
  LOOT_ACTION_LABEL,
  lootActions,
  lootFiltersFor,
  lootRequest,
  type LootAction,
  type LootFilter,
} from '@vtt-chat-app/shared';
import { useState } from 'react';

import { useIsDm } from '../../hooks/useIsDm.js';
import { useLoad } from '../../hooks/useLoad.js';
import { ApiError } from '../../lib/api.js';
import { lootDo, lootItems } from '../../lib/phone/phoneApi.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import type { LootItem, Member } from '../../types/phone.js';

const FILTER_LABEL: Record<LootFilter, string> = {
  all: 'All',
  unassigned: 'Available',
  assigned: 'Taken',
  mine: 'Mine',
};
const ACTION_SHORT: Record<LootAction, string> = {
  take: 'Take',
  store: 'Store for party',
  return: 'Put back',
  give: 'Give to…',
};
const RARITY_COLOR: Record<string, 'gray' | 'green' | 'blue' | 'violet' | 'orange' | 'red'> = {
  common: 'gray',
  uncommon: 'green',
  rare: 'blue',
  'very rare': 'violet',
  legendary: 'orange',
  artifact: 'red',
};

const nameOf = (members: Member[], id: string | null): string => {
  const m = members.find((x) => x.userId === id);
  return m?.character?.name ?? m?.displayName ?? 'someone';
};

/** Who has it, in words: "Available", "Taken by Mira", "In the party stash", "Split among 3". */
function holder(item: LootItem, members: Member[]): string {
  if (!item.claimedBy) return 'Available';
  if (item.claimedFor === 'split' && item.split) return `Split among ${item.split.shares.length}`;
  if (item.claimedFor === 'party') return 'In the party stash';
  const who = nameOf(members, item.claimedBy);
  return item.claimedFor === 'assigned' ? `Given to ${who}` : `Taken by ${who}`;
}

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
  const [filter, setFilter] = useState<LootFilter>('all');
  const [problem, setProblem] = useState<string>();
  const [giving, setGiving] = useState<string>();
  const filters = lootFiltersFor(dm);
  const shown = filterLootItems(data ?? [], filters.includes(filter) ? filter : 'all', selfId);
  const players = members.filter((m) => m.role !== 'dm');

  async function run(item: LootItem, action: LootAction, userId?: string) {
    setProblem(undefined);
    try {
      const req =
        action === 'give' ? lootRequest('give', item, userId ?? '') : lootRequest(action, item);
      await lootDo(campaignId, item.id, req);
      setGiving(undefined);
      reload();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'That did not work. Try again.');
    }
  }

  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <SegmentedControl.Root
        size="1"
        value={filters.includes(filter) ? filter : 'all'}
        onValueChange={(v) => setFilter(v as LootFilter)}
      >
        {filters.map((f) => (
          <SegmentedControl.Item key={f} value={f}>
            {FILTER_LABEL[f]}
          </SegmentedControl.Item>
        ))}
      </SegmentedControl.Root>
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
            : 'Nothing in this list.'}
        </Text>
      )}
      {shown.map((item) => {
        const actions = lootActions(item, selfId, dm);
        return (
          <Card key={item.id} size="2">
            <Flex direction="column" gap="2">
              <Flex gap="2" align="center" wrap="wrap">
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
              {item.description && (
                <Text size="2" color="gray">
                  {item.description}
                </Text>
              )}
              <Text size="1" color={item.claimedBy ? 'violet' : 'green'}>
                {holder(item, members)}
              </Text>
              {actions.length > 0 && (
                <Flex gap="2" wrap="wrap">
                  {actions.map((action) => (
                    <Button
                      key={action}
                      size="1"
                      variant={action === 'take' ? 'solid' : 'soft'}
                      title={LOOT_ACTION_LABEL[action]}
                      onClick={() =>
                        action === 'give'
                          ? setGiving(giving === item.id ? undefined : item.id)
                          : void run(item, action)
                      }
                    >
                      {ACTION_SHORT[action]}
                    </Button>
                  ))}
                </Flex>
              )}
              {giving === item.id && (
                <Select.Root size="1" onValueChange={(userId) => void run(item, 'give', userId)}>
                  <Select.Trigger placeholder="Give to…" />
                  <Select.Content>
                    {players.map((m) => (
                      <Select.Item key={m.userId} value={m.userId}>
                        {m.character?.name ?? m.displayName}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              )}
            </Flex>
          </Card>
        );
      })}
    </Flex>
  );
}
