import { LazyMarkdown } from './LazyMarkdown.js';
import { Badge, Button, Callout, Card, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import { useLoad } from '../../hooks/useLoad.js';
import { recordingTitle, summaryTitle } from '../../lib/phone/format.js';
import { recording, recordings, searchHistory } from '../../lib/phone/phoneApi.js';
import { hitLabel, snippetParts } from '../../lib/phone/search.js';
import type { RecordingItem } from '../../types/phone.js';
import { BackButton } from '../BackButton.js';

const STATUS_NOTE: Record<string, string> = {
  recording: 'Recording now',
  processing: 'Being written up',
  failed: 'Could not be summarised',
};

/** Past sessions and their tales. The Game Master also sees the brief and the scribe's notes. */
export function HistoryTab({ campaignId }: { campaignId: string }) {
  const { data, error, loading } = useLoad(() => recordings(campaignId), campaignId);
  const [open, setOpen] = useState<RecordingItem>();
  if (open) {
    return <RecordingView item={open} campaignId={campaignId} onBack={() => setOpen(undefined)} />;
  }
  const list = [...(data ?? [])].sort((a, b) => b.startedAt - a.startedAt);
  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <Heading size="5">History</Heading>
      <HistorySearch
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
                <Badge color="gray">{r.summaries.length > 0 ? 'Tale ready' : 'No tale yet'}</Badge>
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
  campaignId,
  onBack,
}: {
  item: RecordingItem;
  campaignId: string;
  onBack: () => void;
}) {
  const detail = useLoad(() => recording(campaignId, item.id), item.id);
  // The scribe's notes come to the DM alone and stay folded away: the tale and the brief are what is read.
  const [showNotes, setShowNotes] = useState(false);
  const all = detail.data?.summaries ?? [];
  const hasNotes = all.some((s) => s.kind === 'notes');
  const summaries = all.filter((s) => s.kind !== 'notes' || showNotes);
  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <Flex align="center" gap="3">
        <BackButton onClick={onBack} />
        <Heading size="4" as="h2">
          {recordingTitle(item.startedAt, item.stoppedAt)}
        </Heading>
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
              <Text size="2" weight="medium">
                {summaryTitle(s.kind)}
                {s.subject ? `: ${s.subject}` : ''}
                {s.title ? ` · ${s.title}` : ''}
              </Text>
              {s.visibility !== 'members' && <Badge color="violet">DM only</Badge>}
            </Flex>
            <LazyMarkdown text={s.text} />
          </Flex>
        </Card>
      ))}
      {hasNotes && (
        <Button variant="soft" onClick={() => setShowNotes((v) => !v)}>
          {showNotes ? 'Hide the scribe’s notes' : 'Show the scribe’s notes'}
        </Button>
      )}
    </Flex>
  );
}

const MIN_QUERY = 2;
const TYPING_PAUSE_MS = 400;

/** A search box over the tales and summaries. Waits for a pause in typing before asking. */
function HistorySearch({
  campaignId,
  onOpen,
}: {
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
    () => (active ? searchHistory(campaignId, query) : Promise.resolve([])),
    `${campaignId}:${active ? query : ''}`,
  );
  return (
    <Flex direction="column" gap="2">
      <TextField.Root
        type="search"
        placeholder="Search the tales"
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
