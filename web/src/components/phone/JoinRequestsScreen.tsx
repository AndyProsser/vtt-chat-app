import { Badge, Button, Callout, Card, Flex, Spinner, Switch, Text } from '@radix-ui/themes';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '../../lib/api.js';
import { type DmRequest, pendingIds, sortRequests } from '../../lib/phone/joinRequests.js';
import { decideJoinRequest, joinRequests, setAllowJoin } from '../../lib/phone/phoneApi.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import { initials, portraitUrl } from '../../lib/phone/rail.js';
import type { Member } from '../../types/phone.js';

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/** The DM's list of people asking to join this campaign, with the Allow join switch on top. */
export function JoinRequestsScreen({ campaignId }: { campaignId: string }) {
  const livePending = usePhoneStore((s) => s.joinPending.join(','));
  const [allow, setAllow] = useState<boolean>();
  const [list, setList] = useState<DmRequest[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async () => {
    try {
      const res = await joinRequests(campaignId);
      setAllow(res.allowJoin);
      setList(res.requests);
      setError(undefined);
      usePhoneStore.getState().setJoinPending(pendingIds(res.requests));
    } catch {
      setError('Could not load join requests.');
    }
  }, [campaignId]);

  // On open, and again whenever a live frame changed the pending set.
  useEffect(() => void load(), [load, livePending]);

  const sorted = useMemo(() => sortRequests(list ?? []), [list]);

  const toggle = async (next: boolean) => {
    setBusy('switch');
    setError(undefined);
    try {
      await setAllowJoin(campaignId, next);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change that.');
    } finally {
      setBusy(undefined);
    }
  };

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    setError(undefined);
    try {
      await decideJoinRequest(campaignId, id, approve);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that decision.');
    } finally {
      setBusy(undefined);
      await load();
    }
  };

  if (!list || allow === undefined) {
    return error ? (
      <Text color="red">{error}</Text>
    ) : (
      <Flex justify="center" p="4">
        <Spinner size="3" />
      </Flex>
    );
  }
  return (
    <Flex direction="column" gap="3">
      <Card size="2">
        <Flex align="center" justify="between" gap="3">
          <Flex direction="column" gap="1">
            <Text as="label" htmlFor="allow-join" size="3" weight="medium">
              Allow join
            </Text>
            <Text size="2" color="gray" id="allow-join-help">
              Lets people on this server ask to join this table. You still approve each one.
            </Text>
          </Flex>
          <Switch
            id="allow-join"
            checked={allow}
            disabled={busy === 'switch'}
            onCheckedChange={(v) => void toggle(v)}
            aria-describedby="allow-join-help"
          />
        </Flex>
      </Card>
      {error && (
        <Callout.Root color="red" size="1" role="alert">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {sorted.length === 0 && (
        <Text color="gray" as="p">
          No requests yet.
        </Text>
      )}
      <Flex direction="column" gap="2" asChild>
        <ul className="phone-plain-list" aria-label="Join requests">
          {sorted.map((r) => (
            <li key={r.id}>
              <RequestRow
                request={r}
                busy={busy === r.id}
                onDecide={(approve) => void decide(r.id, approve)}
              />
            </li>
          ))}
        </ul>
      </Flex>
    </Flex>
  );
}

function RequestRow({
  request: r,
  busy,
  onDecide,
}: {
  request: DmRequest;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const pic = portraitUrl({ avatarUrl: r.avatarUrl, character: null } as Member);
  return (
    <Card size="2">
      <Flex gap="3" align="start">
        <span className="phone-join-avatar" aria-hidden="true">
          {pic ? <img src={pic} alt="" /> : initials(r.displayName)}
        </span>
        <Flex direction="column" gap="1" style={{ minWidth: 0, flex: 1 }}>
          <Flex justify="between" gap="2" wrap="wrap">
            <Text weight="medium">{r.displayName}</Text>
            <Text size="1" color="gray">
              {when(r.decidedAt ?? r.createdAt)}
            </Text>
          </Flex>
          {r.message && (
            <Text size="2" className="phone-join-message">
              {r.message}
            </Text>
          )}
          {r.status === 'pending' ? (
            <Flex gap="2" align="center" wrap="wrap" mt="1">
              <Button
                size="2"
                onClick={() => onDecide(true)}
                disabled={busy || r.closed}
                loading={busy}
              >
                Approve
              </Button>
              <Button
                size="2"
                variant="soft"
                color="gray"
                onClick={() => onDecide(false)}
                disabled={busy}
              >
                Decline
              </Button>
              {r.closed && (
                <Badge color="amber" variant="soft">
                  Allow join is off
                </Badge>
              )}
            </Flex>
          ) : (
            <Badge
              color={r.status === 'approved' ? 'green' : 'gray'}
              variant="soft"
              style={{ alignSelf: 'flex-start' }}
            >
              {r.status === 'approved' ? 'Approved' : 'Declined'}
            </Badge>
          )}
        </Flex>
      </Flex>
    </Card>
  );
}
