import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  SegmentedControl,
  Text,
  TextField,
} from '@radix-ui/themes';
import { useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { useCampaignQuery } from '../../hooks/useCampaignQuery.js';
import { useTableFeed } from '../../hooks/useTableFeed.js';
import { isDm } from '../../lib/tableModel.js';
import { useTableStore } from '../../lib/tableStore.js';
import { accountErrorMessage, campaignApi } from '../../lib/tauriBridge.js';
import type { RsvpStatus, SessionView } from '../../types/index.js';

const RSVP_LABELS: Record<RsvpStatus, string> = {
  yes: 'Can make it',
  late: 'Running late',
  no: "Can't",
};

export function SessionsSection() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const { data, error, reload } = useCampaignQuery<{ sessions: SessionView[] }>('sessions', [
    'notification',
    'session.',
  ]);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
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

  const upcoming = data?.sessions.filter((s) => s.session.cancelledAt === null) ?? [];

  return (
    <Flex direction="column" gap="2" p="3">
      <Text weight="bold">Sessions</Text>
      {(error ?? actionError) && (
        <Callout.Root color="red" size="1">
          <Callout.Text>{error ?? actionError}</Callout.Text>
        </Callout.Root>
      )}
      {data && upcoming.length === 0 && (
        <Text size="2" color="gray">
          No session is scheduled.
        </Text>
      )}
      {upcoming.map((v) => (
        <Card key={v.session.id}>
          <Flex direction="column" gap="2">
            <Flex justify="between" align="center">
              <Text weight="bold" size="2">
                {v.session.title}
              </Text>
              {dm && (
                <Button
                  size="1"
                  color="red"
                  variant="soft"
                  onClick={() => void run(() => campaignApi('DELETE', `sessions/${v.session.id}`))}
                >
                  Cancel
                </Button>
              )}
            </Flex>
            <Text size="2">
              {new Date(v.session.startsAt).toLocaleString([], {
                dateStyle: 'full',
                timeStyle: 'short',
              })}
            </Text>
            {v.session.notes && (
              <Text size="1" color="gray">
                {v.session.notes}
              </Text>
            )}
            <SegmentedControl.Root
              size="1"
              value={v.mine ?? ''}
              onValueChange={(s) =>
                void run(() => campaignApi('PUT', `sessions/${v.session.id}/rsvp`, { status: s }))
              }
            >
              {(['yes', 'late', 'no'] as const).map((s) => (
                <SegmentedControl.Item key={s} value={s}>
                  {RSVP_LABELS[s]}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>
            <Flex gap="1">
              <Badge color="green">{v.counts.yes} yes</Badge>
              <Badge color="amber">{v.counts.late} late</Badge>
              <Badge color="gray">{v.counts.no} no</Badge>
            </Flex>
          </Flex>
        </Card>
      ))}
      {dm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const startsAt = new Date(when).getTime();
            if (!title.trim() || Number.isNaN(startsAt)) return;
            void run(() => campaignApi('POST', 'sessions', { title: title.trim(), startsAt })).then(
              () => {
                setTitle('');
                setWhen('');
              },
            );
          }}
        >
          <Flex direction="column" gap="2">
            <Text size="2" weight="bold">
              Schedule a session
            </Text>
            <TextField.Root
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <TextField.Root
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
            <Button type="submit">Schedule</Button>
          </Flex>
        </form>
      )}
    </Flex>
  );
}
