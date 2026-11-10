import { Badge, Button, Callout, Card, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import { useLoad } from '../../hooks/useLoad.js';
import { clock, recordingTitle } from '../../lib/phone/format.js';
import { recording, recordings, searchHistory, transcript } from '../../lib/phone/phoneApi.js';
import { hitLabel, snippetParts } from '../../lib/phone/search.js';
import type { RecordingItem } from '../../types/phone.js';

const STATUS_NOTE: Record<string, string> = {
  recording: 'Recording now',
  processing: 'Being written up',
  failed: 'Could not be summarised',
};

/** Past sessions: the summaries first, the full transcript when you want it. */
export function HistoryTab({ token, campaignId }: { token: string; campaignId: string }) {
  const { data, error, loading } = useLoad(() => recordings(token, campaignId), campaignId);
  const [open, setOpen] = useState<RecordingItem>();
  if (open) {
    return (
      <RecordingView
        item={open}
        token={token}
        campaignId={campaignId}
        onBack={() => setOpen(undefined)}
      />
    );
  }
  const list = [...(data ?? [])].sort((a, b) => b.startedAt - a.startedAt);
  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <Heading size="5">History</Heading>
      <HistorySearch
        token={token}
        campaignId={campaignId}
        onOpen={(id) => {
          const found = list.find((r) => r.id === id);
          if (found) setOpen(found);
        }}
      />
      {error && (
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {!loading && !error && list.length === 0 && (
        <Text color="gray">
          No recorded sessions yet. After a session is recorded, its summary appears here.
        </Text>
      )}
      {list.map((r) => (
        <Card key={r.id} asChild size="2">
          <button type="button" className="phone-card-button" onClick={() => setOpen(r)}>
            <Flex justify="between" align="center" gap="3">
              <Text size="3" weight="medium">
                {recordingTitle(r.startedAt, r.stoppedAt)}
              </Text>
              {STATUS_NOTE[r.status] ? (
                <Badge color={r.status === 'failed' ? 'red' : 'amber'}>
                  {STATUS_NOTE[r.status]}
                </Badge>
              ) : (
                <Badge color="gray">{r.summaries.length} summaries</Badge>
              )}
            </Flex>
          </button>
        </Card>
      ))}
    </Flex>
  );
}

function RecordingView({
  item,
  token,
  campaignId,
  onBack,
}: {
  item: RecordingItem;
  token: string;
  campaignId: string;
  onBack: () => void;
}) {
  const detail = useLoad(() => recording(token, campaignId, item.id), item.id);
  const [showTranscript, setShowTranscript] = useState(false);
  const lines = useLoad(
    () => (showTranscript ? transcript(token, campaignId, item.id) : Promise.resolve([])),
    `${item.id}:${showTranscript}`,
  );
  const summaries = detail.data?.summaries ?? [];
  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <Flex align="center" gap="3">
        <Button variant="soft" onClick={onBack}>
          Back
        </Button>
        <Heading size="4">{recordingTitle(item.startedAt, item.stoppedAt)}</Heading>
      </Flex>
      {detail.error && (
        <Callout.Root color="red">
          <Callout.Text>{detail.error}</Callout.Text>
        </Callout.Root>
      )}
      {!detail.loading && !detail.error && summaries.length === 0 && (
        <Text color="gray">No summary yet. It appears here when it has been written.</Text>
      )}
      {summaries.map((s, i) => (
        <Card key={`${s.kind}:${s.subject ?? ''}:${i}`} size="2">
          <Flex direction="column" gap="2">
            <Flex gap="2" align="center">
              <Text size="2" weight="medium" className="phone-kind">
                {s.kind}
                {s.subject ? `: ${s.subject}` : ''}
              </Text>
              {s.visibility !== 'members' && <Badge color="violet">DM only</Badge>}
            </Flex>
            <div className="phone-note">{s.text}</div>
          </Flex>
        </Card>
      ))}
      <Button variant="soft" onClick={() => setShowTranscript((v) => !v)}>
        {showTranscript ? 'Hide the transcript' : 'Read the transcript'}
      </Button>
      {showTranscript && (
        <Flex direction="column" gap="2">
          {lines.loading && <Text color="gray">Loading…</Text>}
          {lines.error && <Text color="red">{lines.error}</Text>}
          {(lines.data ?? []).map((u, i) => (
            <div key={i} className="phone-utterance">
              <Text size="1" color="gray">
                {clock(u.startMs)} · {u.speaker.name}
              </Text>
              <Text size="2">{u.text}</Text>
            </div>
          ))}
        </Flex>
      )}
    </Flex>
  );
}

const MIN_QUERY = 2;
const TYPING_PAUSE_MS = 400;

/** A search box over everything said, typed and summarised. Waits for a pause in typing before asking. */
function HistorySearch({
  token,
  campaignId,
  onOpen,
}: {
  token: string;
  campaignId: string;
  onOpen: (recordingId: string) => void;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), TYPING_PAUSE_MS);
    return () => clearTimeout(t);
  }, [text]);
  const active = query.length >= MIN_QUERY;
  const hits = useLoad(
    () => (active ? searchHistory(token, campaignId, query) : Promise.resolve([])),
    `${campaignId}:${active ? query : ''}`,
  );
  return (
    <Flex direction="column" gap="2">
      <TextField.Root
        type="search"
        placeholder="Search what was said"
        aria-label="Search the history"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {active && hits.error && <Text color="red">{hits.error}</Text>}
      {active && !hits.loading && !hits.error && (hits.data?.length ?? 0) === 0 && (
        <Text color="gray">Nothing found for “{query}”.</Text>
      )}
      {active &&
        (hits.data ?? []).map((h, i) => (
          <Card key={`${h.recordingId}:${i}`} asChild size="1">
            <button
              type="button"
              className="phone-card-button"
              onClick={() => onOpen(h.recordingId)}
            >
              <Flex direction="column" gap="1">
                <Text size="1" color="gray">
                  {hitLabel(h)}
                </Text>
                <Text size="2">
                  {snippetParts(h.snippet).map((p, j) =>
                    p.mark ? <mark key={j}>{p.text}</mark> : <span key={j}>{p.text}</span>,
                  )}
                </Text>
              </Flex>
            </button>
          </Card>
        ))}
    </Flex>
  );
}
