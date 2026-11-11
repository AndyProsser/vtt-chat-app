import { Button, Flex, Text, TextArea } from '@radix-ui/themes';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  cardState,
  JOIN_MESSAGE_MAX,
  joinErrorMessage,
  markDeclined,
  messageCharsLeft,
  retryLabel,
  vanishedPending,
} from '../../lib/joinRequests.js';
import { useJoinStore } from '../../lib/joinStore.js';
import { accountAddCampaign, joinOpen, joinRequest, joinWithdraw } from '../../lib/tauriBridge.js';
import type { OpenCampaignCard } from '../../types/index.js';
import { SectionHeading } from './SectionHeading.js';

/**
 * The tables that are open to requests, as cards: ask to join with an optional note, withdraw, or see
 * when you may ask again. The list is read when this opens (and by Refresh), never on a timer; an answer
 * that arrives while it is open (`join.decided`) re-reads it.
 */
export function OpenCampaigns() {
  const [cards, setCards] = useState<OpenCampaignCard[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [asking, setAsking] = useState<string>();
  const previous = useRef<OpenCampaignCard[]>([]);
  const decided = useJoinStore((s) => s.decided);

  const load = useCallback(async () => {
    try {
      const { campaigns } = await joinOpen();
      // A request that was waiting and is gone from the list means the DM said yes: pick up the new campaign.
      if (vanishedPending(previous.current, campaigns)) {
        void accountAddCampaign('refresh', '').catch(() => undefined);
      }
      previous.current = campaigns;
      setCards(campaigns);
      setError(undefined);
    } catch (e) {
      setError(joinErrorMessage(e));
      setCards((c) => c ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, decided]);

  async function act(id: string, work: () => Promise<unknown>) {
    setBusy(id);
    setError(undefined);
    try {
      await work();
      setAsking(undefined);
    } catch (e) {
      setError(joinErrorMessage(e));
    } finally {
      setBusy(undefined);
      await load();
    }
  }

  const shown =
    cards && decided && !decided.approved
      ? markDeclined(cards, decided.campaignId, decided.requestId, Date.now())
      : cards;

  return (
    <Flex direction="column" className="vtt-settings-section">
      <div className="vtt-join-head">
        <SectionHeading
          title="Tables open to requests"
          hint="Ask the DM to let you in. They decide; you will be told."
        />
        <button
          type="button"
          className="vtt-tool"
          aria-label="Refresh the list"
          title="Refresh the list"
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      {shown && shown.length === 0 && !error && (
        <div className="vtt-card">
          <span className="vtt-muted">No tables are open to requests right now.</span>
        </div>
      )}
      {shown && shown.length > 0 && (
        <div className="vtt-card">
          {shown.map((c) => (
            <OpenCampaignRow
              key={c.id}
              card={c}
              busy={busy === c.id}
              asking={asking === c.id}
              onAsk={() => setAsking(c.id)}
              onCancel={() => setAsking(undefined)}
              onSend={(message) => void act(c.id, () => joinRequest(c.id, message))}
              onWithdraw={() => void act(c.id, () => joinWithdraw(c.id))}
            />
          ))}
        </div>
      )}
    </Flex>
  );
}

function OpenCampaignRow({
  card,
  busy,
  asking,
  onAsk,
  onCancel,
  onSend,
  onWithdraw,
}: {
  card: OpenCampaignCard;
  busy: boolean;
  asking: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onSend: (message: string) => void;
  onWithdraw: () => void;
}) {
  const [message, setMessage] = useState('');
  const state = cardState(card.myRequest);
  return (
    <div className="vtt-join-row">
      <Flex align="center" justify="between" gap="3">
        <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
          <Text size="2" weight="bold" className="vtt-join-name">
            {card.name}
          </Text>
          <Text size="1" color="gray">
            DM: {card.dmName} · {card.playerCount} {card.playerCount === 1 ? 'player' : 'players'}
          </Text>
          {state.kind === 'declined' && (
            <Text size="1" color="gray">
              {retryLabel(state.retryAfter)}
            </Text>
          )}
        </Flex>
        <Flex gap="2" align="center" style={{ flex: 'none' }}>
          {state.kind === 'none' && !asking && (
            <Button size="1" variant="soft" onClick={onAsk}>
              Request to join
            </Button>
          )}
          {state.kind === 'pending' && (
            <>
              <Text size="1" color="gray">
                Request sent
              </Text>
              <Button size="1" variant="outline" color="gray" disabled={busy} onClick={onWithdraw}>
                Withdraw
              </Button>
            </>
          )}
          {state.kind === 'declined' && (
            <Button size="1" variant="soft" color="gray" disabled>
              Not this time
            </Button>
          )}
        </Flex>
      </Flex>
      {state.kind === 'none' && asking && (
        <form
          className="vtt-join-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSend(message);
          }}
        >
          <TextArea
            size="1"
            aria-label={`Message to the DM of ${card.name}`}
            placeholder="Say hello (optional)"
            maxLength={JOIN_MESSAGE_MAX}
            rows={3}
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Flex align="center" justify="between" gap="2">
            <Text size="1" color="gray">
              {messageCharsLeft(message)} left
            </Text>
            <Flex gap="2">
              <Button type="button" size="1" variant="outline" color="gray" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" size="1" disabled={busy}>
                Send request
              </Button>
            </Flex>
          </Flex>
        </form>
      )}
    </div>
  );
}
