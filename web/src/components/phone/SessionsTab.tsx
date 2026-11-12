import { Badge, Button, Callout, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { useState } from 'react';

import { useLoad } from '../../hooks/useLoad.js';
import { RSVP_LABEL, sessionDistance, sessionWhen } from '../../lib/phone/format.js';
import { answerRsvp, sessions } from '../../lib/phone/phoneApi.js';
import type { RsvpStatus, SessionItem } from '../../types/phone.js';

const ANSWERS: RsvpStatus[] = ['yes', 'late', 'no'];

/** Upcoming sessions, and your answer to each. */
export function SessionsTab({ campaignId }: { campaignId: string }) {
  const { data, error, loading, reload } = useLoad(() => sessions(campaignId), campaignId);
  const upcoming = (data ?? []).filter((s) => s.session.cancelledAt === null);
  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <Heading size="5">Sessions</Heading>
      {error && (
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {!loading && !error && upcoming.length === 0 && (
        <Text color="gray">Nothing is scheduled. Your DM will add the next session here.</Text>
      )}
      {upcoming.map((item) => (
        <SessionCard
          key={item.session.id}
          item={item}
          campaignId={campaignId}
          onAnswered={reload}
        />
      ))}
    </Flex>
  );
}

function SessionCard({
  item,
  campaignId,
  onAnswered,
}: {
  item: SessionItem;
  campaignId: string;
  onAnswered: () => void;
}) {
  const { session } = item;
  const [busy, setBusy] = useState<RsvpStatus>();
  const [error, setError] = useState<string>();
  async function answer(status: RsvpStatus) {
    setBusy(status);
    setError(undefined);
    try {
      await answerRsvp(campaignId, session.id, status);
      onAnswered();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your answer.');
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <Card size="2">
      <Flex direction="column" gap="2">
        <Flex justify="between" align="start" gap="2">
          <Text size="4" weight="medium">
            {session.title}
          </Text>
          <Badge color="gray">{sessionDistance(session.startsAt, Date.now())}</Badge>
        </Flex>
        <Text size="2" color="gray">
          {sessionWhen(session.startsAt, session.durationMinutes)}
        </Text>
        {session.notes && <Text size="2">{session.notes}</Text>}
        <Flex gap="2" wrap="wrap" mt="1" role="group" aria-label="Your answer">
          {ANSWERS.map((a) => (
            <Button
              key={a}
              size="2"
              variant={item.mine === a ? 'solid' : 'soft'}
              color={a === 'no' ? 'red' : a === 'late' ? 'amber' : 'green'}
              aria-pressed={item.mine === a}
              loading={busy === a}
              onClick={() => void answer(a)}
            >
              {RSVP_LABEL[a]}
            </Button>
          ))}
        </Flex>
        <Text size="1" color="gray">
          {item.counts.yes} in · {item.counts.late} late · {item.counts.no} out
        </Text>
        {error && (
          <Text size="1" color="red" role="alert">
            {error}
          </Text>
        )}
      </Flex>
    </Card>
  );
}
