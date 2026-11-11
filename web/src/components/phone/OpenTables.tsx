import { Badge, Button, Card, Flex, Spinner, Text, TextArea } from '@radix-ui/themes';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../../lib/api.js';
import {
  cardState,
  joinErrorMessage,
  MAX_JOIN_MESSAGE,
  messageLength,
  type OpenTable,
  retryText,
} from '../../lib/phone/joinRequests.js';
import {
  campaigns,
  openTables,
  requestToJoin,
  withdrawJoinRequest,
} from '../../lib/phone/phoneApi.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';

/** How often the list looks again, so an answer shows up without a reload. */
const POLL_MS = 20_000;

const failure = (e: unknown): string =>
  e instanceof ApiError ? joinErrorMessage(e.status, e.message) : joinErrorMessage(0, '');

/**
 * Tables that take requests to join, as cards. Used on the no-campaign screen and behind "Find another table".
 * It looks again every 20 seconds: a person with no campaign has no live connection yet, and this is also how
 * an approval reaches them (a new campaign appears, which raises the "You're in" banner).
 */
export function OpenTables({ emptyHint }: { emptyHint?: string }) {
  const [tables, setTables] = useState<OpenTable[]>();
  const [error, setError] = useState<string>();
  const [asking, setAsking] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [rowError, setRowError] = useState<{ id: string; text: string }>();
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [list, mine] = await Promise.all([openTables(), campaigns()]);
      if (!alive.current) return;
      setTables(list);
      setError(undefined);
      const store = usePhoneStore.getState();
      const known = new Set(store.campaigns.map((c) => c.id));
      const fresh = mine.find((c) => !known.has(c.id));
      if (fresh) {
        store.setCampaigns(mine);
        usePhoneStore.setState({ decision: { campaignId: fresh.id, approved: true } });
      }
    } catch {
      if (alive.current) setError('Could not load the open tables.');
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  const send = async (id: string, message: string) => {
    setBusy(id);
    setRowError(undefined);
    try {
      await requestToJoin(id, message.trim());
      setAsking(undefined);
    } catch (e) {
      setRowError({ id, text: failure(e) });
    } finally {
      setBusy(undefined);
      void refresh();
    }
  };

  const withdraw = async (id: string) => {
    setBusy(id);
    setRowError(undefined);
    try {
      await withdrawJoinRequest(id);
    } catch (e) {
      setRowError({ id, text: failure(e) });
    } finally {
      setBusy(undefined);
      void refresh();
    }
  };

  if (error && !tables) return <Text color="red">{error}</Text>;
  if (!tables) {
    return (
      <Flex justify="center" p="4">
        <Spinner size="3" />
      </Flex>
    );
  }
  if (tables.length === 0) {
    return (
      <Text color="gray" as="p">
        {emptyHint ?? 'No tables are open to requests right now.'}
      </Text>
    );
  }
  return (
    <Flex direction="column" gap="3" asChild>
      <ul className="phone-plain-list" aria-label="Open tables">
        {tables.map((t) => (
          <li key={t.id}>
            <TableCard
              table={t}
              asking={asking === t.id}
              busy={busy === t.id}
              error={rowError?.id === t.id ? rowError.text : undefined}
              onAsk={() => {
                setRowError(undefined);
                setAsking(t.id);
              }}
              onCancel={() => setAsking(undefined)}
              onSend={(m) => void send(t.id, m)}
              onWithdraw={() => void withdraw(t.id)}
            />
          </li>
        ))}
      </ul>
    </Flex>
  );
}

function TableCard({
  table,
  asking,
  busy,
  error,
  onAsk,
  onCancel,
  onSend,
  onWithdraw,
}: {
  table: OpenTable;
  asking: boolean;
  busy: boolean;
  error: string | undefined;
  onAsk: () => void;
  onCancel: () => void;
  onSend: (message: string) => void;
  onWithdraw: () => void;
}) {
  const [message, setMessage] = useState('');
  const state = cardState(table.myRequest, Date.now());
  const length = messageLength(message);
  const over = length > MAX_JOIN_MESSAGE;
  return (
    <Card size="2" className="phone-table-card">
      <Flex direction="column" gap="2">
        <Flex justify="between" align="start" gap="3" wrap="wrap">
          <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
            <Text size="4" weight="medium">
              {table.name}
            </Text>
            <Text size="2" color="gray">
              DM: {table.dmName}
            </Text>
          </Flex>
          <Badge color="gray" variant="soft">
            {table.playerCount} {table.playerCount === 1 ? 'player' : 'players'}
          </Badge>
        </Flex>

        {state.kind === 'none' && !asking && (
          <Button variant="soft" onClick={onAsk} disabled={busy}>
            Request to join
          </Button>
        )}
        {state.kind === 'none' && asking && (
          <form
            className="phone-join-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!over) onSend(message);
            }}
          >
            <label>
              <Text size="2" color="gray">
                Say hello to the DM (optional)
              </Text>
              <TextArea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={MAX_JOIN_MESSAGE * 2}
                aria-describedby={`count-${table.id}`}
                autoFocus
              />
            </label>
            <Text
              id={`count-${table.id}`}
              size="1"
              color={over ? 'red' : 'gray'}
              className="phone-join-count"
            >
              {length}/{MAX_JOIN_MESSAGE}
            </Text>
            <Flex gap="2">
              <Button type="submit" disabled={busy || over} loading={busy}>
                Send request
              </Button>
              <Button type="button" variant="soft" color="gray" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            </Flex>
          </form>
        )}
        {state.kind === 'pending' && (
          <Flex align="center" justify="between" gap="2" wrap="wrap">
            <Badge color="violet" variant="soft">
              Request sent
            </Badge>
            <Button variant="ghost" color="gray" onClick={onWithdraw} disabled={busy}>
              Withdraw
            </Button>
          </Flex>
        )}
        {state.kind === 'declined' && (
          <Flex direction="column" gap="1">
            <Button variant="soft" color="gray" disabled>
              Not this time
            </Button>
            <Text size="1" color="gray">
              {retryText(state.retryAfter)}
            </Text>
          </Flex>
        )}
        {error && (
          <Text size="2" color="red" role="alert">
            {error}
          </Text>
        )}
      </Flex>
    </Card>
  );
}
