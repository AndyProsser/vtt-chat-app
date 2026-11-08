import { Badge, Button, Callout, Flex, Select, Text, TextField } from '@radix-ui/themes';
import { useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { accountErrorMessage, syncCommand } from '../lib/tauriBridge.js';

const NONE = '__none__';

/** Voice groups. Everyone sees who is in which group; the DM splits and reassigns. */
export function PartiesPanel() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const view = useTableStore((s) => s.parties);
  const dm = isDm(members, status?.userId ?? null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();

  async function send(t: string, d: Record<string, unknown>) {
    try {
      setError(undefined);
      await syncCommand(t, d);
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }
  const players = members.filter((m) => m.role !== 'dm');

  return (
    <Flex direction="column" gap="3" p="3">
      <Flex justify="between" align="center">
        <Text weight="bold">Voice groups</Text>
        <Badge color={view.split ? 'amber' : 'gray'}>
          {view.split ? 'Split' : 'Everyone together'}
        </Badge>
      </Flex>
      {error && (
        <Callout.Root color="red" size="1">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {players.map((m) => {
        const party = view.assignments[m.userId];
        return (
          <Flex key={m.userId} justify="between" align="center" gap="2">
            <Text size="2">{m.character?.name ?? m.displayName}</Text>
            {dm ? (
              <Select.Root
                size="1"
                value={party ?? NONE}
                onValueChange={(v) =>
                  void send('party.move', { userId: m.userId, partyId: v === NONE ? null : v })
                }
              >
                <Select.Trigger />
                <Select.Content>
                  <Select.Item value={NONE}>No group</Select.Item>
                  {view.parties.map((p) => (
                    <Select.Item key={p.id} value={p.id}>
                      {p.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            ) : (
              <Text size="1" color="gray">
                {view.parties.find((p) => p.id === party)?.name ?? '—'}
              </Text>
            )}
          </Flex>
        );
      })}
      {dm && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim();
              if (!n) return;
              void send('party.create', { name: n }).then(() => setName(''));
            }}
          >
            <Flex gap="2">
              <TextField.Root
                style={{ flex: 1 }}
                placeholder="New group…"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit">Add</Button>
            </Flex>
          </form>
          <Flex gap="2" wrap="wrap">
            {view.parties.map((p) => (
              <Button
                key={p.id}
                size="1"
                variant="soft"
                color="gray"
                onClick={() => void send('party.delete', { partyId: p.id })}
              >
                Remove {p.name}
              </Button>
            ))}
            <Button
              size="1"
              color="red"
              variant="soft"
              onClick={() => void send('party.reset', {})}
            >
              Bring everyone together
            </Button>
          </Flex>
        </>
      )}
    </Flex>
  );
}
