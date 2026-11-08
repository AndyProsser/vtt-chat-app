import { Button, Callout, Card, Flex, Text, TextField } from '@radix-ui/themes';
import { useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';
import type { LootItem } from '../types/index.js';

export function LootPanel() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const { data, error, reload } = useCampaignQuery<{ loot: LootItem[] }>('loot', ['loot.']);
  const [name, setName] = useState('');
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
  const who = (id: string | null) => members.find((m) => m.userId === id)?.displayName ?? 'someone';

  return (
    <Flex direction="column" gap="2" p="3">
      <Text weight="bold">Party inventory</Text>
      {(error ?? actionError) && (
        <Callout.Root color="red" size="1">
          <Callout.Text>{error ?? actionError}</Callout.Text>
        </Callout.Root>
      )}
      {data?.loot.length === 0 && (
        <Text size="2" color="gray">
          Nothing on the table.
        </Text>
      )}
      {data?.loot.map((item) => (
        <Card key={item.id} style={{ opacity: item.claimedBy ? 0.6 : 1 }}>
          <Flex justify="between" align="center" gap="2">
            <Flex direction="column">
              <Text size="2" weight="bold">
                {item.name}
                {item.quantity > 1 ? ` ×${item.quantity}` : ''}
              </Text>
              {item.description && (
                <Text size="1" color="gray">
                  {item.description}
                </Text>
              )}
              {item.claimedBy && (
                <Text size="1" color="gray">
                  Taken by {who(item.claimedBy)}
                </Text>
              )}
            </Flex>
            <Flex gap="1">
              {!item.claimedBy && !dm && (
                <Button
                  size="1"
                  onClick={() => void run(() => campaignApi('POST', `loot/${item.id}/claim`, {}))}
                >
                  Take
                </Button>
              )}
              {dm && (
                <Button
                  size="1"
                  color="red"
                  variant="soft"
                  onClick={() => void run(() => campaignApi('DELETE', `loot/${item.id}`))}
                >
                  Remove
                </Button>
              )}
            </Flex>
          </Flex>
        </Card>
      ))}
      {dm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            void run(() => campaignApi('POST', 'loot', { name: n })).then(() => setName(''));
          }}
        >
          <Flex gap="2">
            <TextField.Root
              style={{ flex: 1 }}
              placeholder="Drop an item…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit">Drop</Button>
          </Flex>
        </form>
      )}
    </Flex>
  );
}
