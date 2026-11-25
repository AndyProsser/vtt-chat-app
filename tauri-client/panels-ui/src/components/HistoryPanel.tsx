import { TextField } from '@radix-ui/themes';
import { summaryBlurb, type HistoryTabId } from '@vtt-chat-app/shared';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useRecordingSummaries } from '../hooks/useRecordingSummaries.js';
import { useDevBuilds } from '../hooks/useDevBuilds.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import {
  canDeleteSession,
  audioDeletionNote,
  clock,
  durationLabel,
  shownHits,
  snippetParts,
  speakerName,
  summaryLabel,
  type RecordingItem,
  type SearchHit,
  transcriptRows,
  type TranscriptRow,
  type SceneMarker,
  type Utterance,
} from '../lib/history.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import {
  accountErrorMessage,
  campaignApi,
  recordsSearch,
  sessionViewOpen,
} from '../lib/tauriBridge.js';
import { SessionTabs } from './SessionTabs.js';
import { SessionDelete } from './SessionDelete.js';
import { EmptyState } from './EmptyState.js';

const statusWord = (status: string): string =>
  ({
    recording: 'recording now',
    stopped: 'waiting to process',
    processing: 'processing',
    failed: 'processing failed',
  })[status] ?? status;

const dateOf = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * The campaign's recorded sessions: when, how long, and their tales, plus a search across them. What each
 * person sees is decided by the server: the DM's brief and the scribe's notes come back to the DM alone, so
 * this screen shows whatever it is given. The one choice made here: the raw transcript (which the server
 * gives only to the DM) is shown only when the DM has dev builds on. It is a diagnostic view, not the record
 * the table reads (decided 2026-11-17).
 */
export function HistoryPanel() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const transcript = useDevBuilds() && dm;
  const { data, error, reload } = useCampaignQuery<{ recordings: RecordingItem[] }>(
    'recordings',
    [],
  );
  const [openId, setOpenId] = useState<string>();
  // The server removes a deleted session in the background (its audio first), so hide it here at once.
  // (Declared before it is read: reading a `const` earlier throws, which blanked this whole panel in 0.5.3 to 0.5.4.)
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const recordings = (data?.recordings ?? []).filter((r) => !gone.has(r.id));
  const devBuilds = useDevBuilds();
  function removed(id: string) {
    setGone((g) => new Set(g).add(id));
    setOpenId(undefined);
    reload();
  }

  return (
    <div className="vtt-sessions">
      <h2 className="vtt-head vtt-panel-title">Session history</h2>
      <SearchBox onOpen={setOpenId} transcript={transcript} />
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      {data && recordings.length === 0 && (
        <EmptyState>
          No recorded sessions yet. When the DM records a session, its summary appears here once it
          has been processed.
        </EmptyState>
      )}
      {recordings.map((r) => (
        <Recording
          key={r.id}
          item={r}
          dm={dm}
          transcript={transcript}
          open={openId === r.id}
          onToggle={() => setOpenId(openId === r.id ? undefined : r.id)}
          canDelete={canDeleteSession(r, dm, devBuilds)}
          onRemoved={() => removed(r.id)}
        />
      ))}
    </div>
  );
}

function SearchBox({ onOpen, transcript }: { onOpen: (id: string) => void; transcript: boolean }) {
  const [text, setText] = useState('');
  const [hits, setHits] = useState<SearchHit[]>();
  const [error, setError] = useState<string>();

  // Searches as you type (after a short pause), and on Enter; an empty box clears the results.
  async function run(query: string) {
    if (query.trim().length < 2) return;
    try {
      setError(undefined);
      setHits(shownHits((await recordsSearch(query)).hits, transcript));
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }
  useEffect(() => {
    if (text.trim().length < 2) return;
    const t = setTimeout(() => void run(text), 400);
    return () => clearTimeout(t);
  }, [text]);

  return (
    <div className="vtt-sessions">
      <form
        className="vtt-form-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(text);
        }}
      >
        <Search size={14} aria-hidden />
        <TextField.Root
          size="1"
          style={{ flex: 1, minWidth: 140 }}
          aria-label="Search the history"
          placeholder={transcript ? 'Search the tales and what was said…' : 'Search the tales…'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value === '') setHits(undefined);
          }}
        />
      </form>
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      {hits && hits.length === 0 && <span className="vtt-muted">Nothing matched.</span>}
      {hits?.map((h, i) => (
        <button
          key={`${h.recordingId}-${i}`}
          type="button"
          className="vtt-hit"
          onClick={() => onOpen(h.recordingId)}
        >
          <span className="vtt-muted">
            {h.source === 'summary'
              ? summaryLabel(h.kind ?? 'session')
              : `${h.speakerName ?? 'Someone'}${h.source === 'chat' ? ' (typed)' : ''}${h.atMs !== undefined ? ` at ${clock(h.atMs)}` : ''}`}
          </span>
          <span>
            {snippetParts(h.snippet).map((p, j) =>
              p.mark ? <mark key={j}>{p.text}</mark> : <span key={j}>{p.text}</span>,
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

function Recording({
  item,
  dm,
  transcript,
  open,
  onToggle,
  canDelete,
  onRemoved,
}: {
  item: RecordingItem;
  dm: boolean;
  transcript: boolean;
  open: boolean;
  onToggle: () => void;
  canDelete: boolean;
  onRemoved: () => void;
}) {
  return (
    <section className="vtt-session">
      <div className="vtt-session-top">
        <button type="button" className="vtt-char-head" aria-expanded={open} onClick={onToggle}>
          <span className="vtt-char-text">
            <b>{dateOf(item.startedAt)}</b>
            <span className="vtt-muted">
              {durationLabel(item.startedAt, item.stoppedAt)}
              {item.summaries.length === 0 && item.status !== 'processed'
                ? ` · ${statusWord(item.status)}`
                : ''}
              {item.summaries.length > 0 ? ` · ${summaryBlurb(item.summaries)}` : ''}
              {dm && item.audio === 'purged' ? ' · audio deleted' : ''}
            </span>
          </span>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {canDelete && <SessionDelete id={item.id} onRemoved={onRemoved} />}
      </div>
      {open && <Detail id={item.id} canReadTranscript={transcript} />}
      {open && audioDeletionNote(item, dm) && (
        <span className="vtt-warning" role="status">
          {audioDeletionNote(item, dm)}
        </span>
      )}
    </section>
  );
}

function Detail({ id, canReadTranscript }: { id: string; canReadTranscript: boolean }) {
  const { summaries, error } = useRecordingSummaries(id);
  // The tab being read, so the pop-out window opens on the same part.
  const [tab, setTab] = useState<HistoryTabId>('tale');

  return (
    <div className="vtt-sessions">
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      {summaries?.length === 0 && (
        <span className="vtt-muted">No summary yet: it appears once processing finishes.</span>
      )}
      {summaries && (
        <SessionTabs
          summaries={summaries}
          onTabChange={setTab}
          onPopout={() => void sessionViewOpen(id, tab).catch(console.error)}
          transcript={canReadTranscript ? <TranscriptTab id={id} /> : undefined}
        />
      )}
    </div>
  );
}

/** The raw transcript, loaded when its tab is opened (the Game Master's, and only with "Include dev builds" on). */
function TranscriptTab({ id }: { id: string }) {
  const [rows, setRows] = useState<TranscriptRow[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    campaignApi<{ utterances: Utterance[]; markers?: SceneMarker[] }>(
      'GET',
      `recordings/${id}/transcript`,
    ).then(
      (d) => !cancelled && setRows(transcriptRows(d.utterances, d.markers)),
      (e: unknown) => !cancelled && setError(accountErrorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (error) {
    return (
      <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
        {error}
      </div>
    );
  }
  if (!rows) return <span className="vtt-muted">Loading the transcript…</span>;
  return (
    <div className="vtt-transcript">
      {rows.length === 0 && <span className="vtt-muted">No transcript yet.</span>}
      {rows.map((row, i) =>
        row.kind === 'scene' ? (
          <p key={i} className="vtt-muted" style={{ borderBlockStart: '1px solid currentColor' }}>
            {clock(row.atMs)} · <b>Scene: {row.name}</b>
          </p>
        ) : (
          <p key={i}>
            <span className="vtt-muted">{clock(row.line.startMs)}</span>{' '}
            <b>{speakerName(row.line.speaker)}</b>
            {row.line.typed ? <span className="vtt-muted"> (typed)</span> : null} {row.line.text}
          </p>
        ),
      )}
    </div>
  );
}
