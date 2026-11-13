import { Badge, Button, Callout, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { useState } from 'react';

import { useConfirmClick } from '../../hooks/useConfirmClick.js';
import { useIsDm } from '../../hooks/useIsDm.js';
import { useLoad } from '../../hooks/useLoad.js';
import { useReturnFocus } from '../../hooks/useReturnFocus.js';
import { ApiError } from '../../lib/api.js';
import { RSVP_LABEL, sessionDistance, sessionWhen } from '../../lib/phone/format.js';
import { answerRsvp, cancelSession, sessions } from '../../lib/phone/phoneApi.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import { canCancel } from '../../lib/phone/sessionForm.js';
import type { RsvpStatus, SessionItem } from '../../types/phone.js';
import { IconTool } from './IconTool.js';
import { LazyMarkdown } from './LazyMarkdown.js';
import { SessionEditor } from './SessionEditor.js';

const ANSWERS: RsvpStatus[] = ['yes', 'late', 'no'];

type View = { page: 'list' } | { page: 'write'; id?: string };

/** Upcoming sessions, and your answer to each. The DM also schedules, changes and cancels them here. */
export function SessionsTab({ campaignId }: { campaignId: string }) {
  const rev = usePhoneStore((s) => s.sessionsRev);
  const isDm = useIsDm(campaignId);
  const { data, error, loading, reload } = useLoad(
    () => sessions(campaignId),
    `${campaignId}:${rev}`,
  );
  const [view, setView] = useState<View>({ page: 'list' });
  const upcoming = (data ?? []).filter((s) => s.session.cancelledAt === null);
  const editing =
    view.page === 'write' && view.id ? upcoming.find((s) => s.session.id === view.id) : undefined;
  useReturnFocus(
    view.page === 'list',
    view.page === 'write' && view.id ? `edit-${view.id}` : 'new-session',
  );

  if (view.page === 'write' && isDm && (!view.id || editing)) {
    return (
      <SessionEditor
        campaignId={campaignId}
        {...(editing ? { session: editing.session } : {})}
        titles={(data ?? []).map((s) => s.session.title)}
        onCancel={() => setView({ page: 'list' })}
        onDone={() => {
          reload();
          setView({ page: 'list' });
        }}
      />
    );
  }
  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <div className="phone-head-row">
        <Heading size="5">Sessions</Heading>
        {isDm && (
          <IconTool
            label="Schedule a session"
            icon="calendarPlus"
            data-focus="new-session"
            onClick={() => setView({ page: 'write' })}
          />
        )}
      </div>
      {error && (
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {!loading && !error && upcoming.length === 0 && (
        <Text color="gray">
          {isDm
            ? 'Nothing is scheduled. Tap the calendar button to schedule the next session.'
            : 'Nothing is scheduled. Your DM will add the next session here.'}
        </Text>
      )}
      {upcoming.map((item) => (
        <SessionCard
          key={item.session.id}
          item={item}
          campaignId={campaignId}
          isDm={isDm}
          onChanged={reload}
          onEdit={() => setView({ page: 'write', id: item.session.id })}
        />
      ))}
    </Flex>
  );
}

function SessionCard({
  item,
  campaignId,
  isDm,
  onChanged,
  onEdit,
}: {
  item: SessionItem;
  campaignId: string;
  isDm: boolean;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const { session } = item;
  const [busy, setBusy] = useState<RsvpStatus>();
  const [error, setError] = useState<string>();
  async function answer(status: RsvpStatus) {
    setBusy(status);
    setError(undefined);
    try {
      await answerRsvp(campaignId, session.id, status);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your answer.');
    } finally {
      setBusy(undefined);
    }
  }
  const cancel = useConfirmClick(async () => {
    setError(undefined);
    try {
      await cancelSession(campaignId, session.id);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel the session.');
    }
  });
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
        {session.notes && <LazyMarkdown text={session.notes} />}
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
        {isDm && (
          <Flex gap="2" wrap="wrap" className="phone-actions">
            <IconTool
              label="Edit this session"
              icon="pencil"
              text="Edit"
              data-focus={`edit-${session.id}`}
              onClick={onEdit}
            />
            {canCancel(session.startsAt, Date.now()) && (
              <IconTool
                label={cancel.armed ? 'Press again to cancel the session' : 'Cancel this session'}
                icon="trash"
                text={cancel.armed ? 'Press again to cancel' : 'Cancel session'}
                danger
                onClick={cancel.press}
              />
            )}
          </Flex>
        )}
        {error && (
          <Text size="1" color="red" role="alert">
            {error}
          </Text>
        )}
      </Flex>
    </Card>
  );
}
