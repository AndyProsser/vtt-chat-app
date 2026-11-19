import { Badge, Callout, Card, Flex, Text } from '@radix-ui/themes';
import {
  canConfirm,
  isConfirmed,
  LOOT_ACTION_LABEL,
  lootActions,
  lootRequest,
  type LootAction,
} from '@vtt-chat-app/shared';
import { useState } from 'react';

import { ApiError } from '../../lib/api.js';
import { holder } from '../../lib/phone/lootCards.js';
import { lootConfirm, lootDo } from '../../lib/phone/phoneApi.js';
import { ConfirmBox } from './ConfirmBox.js';
import type { LootItem, Member } from '../../types/phone.js';
import { GiveSelect } from './GiveSelect.js';
import { LootButtons } from './LootButtons.js';

/**
 * A loot item in the chat: its name, who has it, and the buttons that fit you (take, store, return; for the
 * Game Master a Give list). The same rules as the Loot tab (`lootActions`), so the two cannot disagree.
 */
export function LootChatCard({
  item,
  members,
  selfId,
  dm,
  campaignId,
  onDone,
}: {
  item: LootItem;
  members: Member[];
  selfId: string | null;
  dm: boolean;
  campaignId: string;
  onDone: () => void;
}) {
  const [problem, setProblem] = useState<string>();
  const actions = lootActions(item, selfId, dm);
  const players = members.filter((m) => m.role !== 'dm');

  async function run(action: LootAction, userId?: string) {
    setProblem(undefined);
    try {
      const req =
        action === 'give' ? lootRequest('give', item, userId ?? '') : lootRequest(action, item);
      await lootDo(campaignId, item.id, req);
      onDone();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'That did not work. Try again.');
    }
  }

  return (
    <Card
      size="1"
      className={item.claimedBy ? 'phone-loot-card phone-loot-taken' : 'phone-loot-card'}
    >
      <Flex direction="column" gap="1">
        <Flex gap="2" align="start" justify="between">
          <Flex gap="2" align="center" wrap="wrap" style={{ minWidth: 0 }}>
            <Text weight="medium" size="2">
              {item.kind === 'coin'
                ? `${item.quantity} ${item.name}`
                : `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`}
            </Text>
            {item.rarity && <Badge size="1">{item.rarity}</Badge>}
            <Text size="1" color={item.claimedBy ? 'violet' : 'green'}>
              {holder(item, members)}
            </Text>
          </Flex>
          {actions.length > 0 && (
            <Flex gap="2" justify="end" style={{ flex: 'none' }}>
              {actions.map((action) =>
                action === 'give' ? (
                  <GiveSelect
                    key={action}
                    players={players}
                    onPick={(id) => void run('give', id)}
                  />
                ) : (
                  <LootButtons
                    key={action}
                    action={action}
                    title={LOOT_ACTION_LABEL[action]}
                    onClick={() => void run(action)}
                  />
                ),
              )}
            </Flex>
          )}
        </Flex>
        {item.description && (
          <Text size="1" color="gray">
            {item.description}
          </Text>
        )}
        {canConfirm(item, selfId, dm) && (
          <ConfirmBox
            checked={isConfirmed(item, selfId)}
            onChange={(v) => {
              setProblem(undefined);
              lootConfirm(campaignId, item.id, v).then(onDone, (e: unknown) =>
                setProblem(e instanceof ApiError ? e.message : 'That did not work. Try again.'),
              );
            }}
          />
        )}
        {problem && (
          <Callout.Root color="red" size="1">
            <Callout.Text>{problem}</Callout.Text>
          </Callout.Root>
        )}
      </Flex>
    </Card>
  );
}
