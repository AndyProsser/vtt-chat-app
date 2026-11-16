import { TextField } from '@radix-ui/themes';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useDevBuilds } from '../hooks/useDevBuilds.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import {
  audioActions,
  audioDeletionNote,
  clock,
  durationLabel,
  shownHits,
  snippetParts,
  speakerName,
  summaryLabel,
  type RecordingItem,
  type SearchHit,
  type SummaryView,
  transcriptRows,
  type TranscriptRow,
  type SceneMarker,
  type Utterance,
} from '../lib/history.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { accountErrorMessage, campaignApi, recordsSearch } from '../lib/tauriBridge.js';
import { MarkdownView } from './MarkdownView.js';
import { SessionDelete } from './SessionDelete.js';
import { ToolButton } from './ToolButton.js';
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
  const [actionError, setActionError] = useState<string>();
  const recordings = data?.recordings ?? [];

  async function remove(id: string) {
    try {
      setActionError(undefined);
      await campaignApi('DELETE', `recordings/${id}`);
      setOpenId(undefined);
      reload();
    } catch (e) {
      setActionError(accountErrorMessage(e));
    }
  }

  return (
    <div className="vtt-sessions">
      <SearchBox onOpen={setOpenId} transcript={transcript} />
      {(error ?? actionError) && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error ?? actionError}
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
          onRemove={() => remove(r.id)}
          onAudioDeleted={reload}
        />
      ))}
    </div>
  );
}

function SearchBox({ onOpen, transcript }: { onOpen: (id: string) => void; transcript: boolean }) {
  const [text, setText] = useState('');
  const [hits, setHits] = useState<SearchHit[]>();
  const [error, setError] = useState<string>();

  async function run() {
    if (text.trim().length < 2) return;
    try {
      setError(undefined);
      setHits(shownHits((await recordsSearch(text)).hits, transcript));
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }

  return (
    <div className="vtt-sessions">
      <form
        className="vtt-form-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <TextField.Root
          size="1"
          style={{ flex: 1, minWidth: 140 }}
          aria-label="Search the history"
          placeholder={transcript ? 'Search the tales and what was said' : 'Search the tales'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value === '') setHits(undefined);
          }}
        />
        <ToolButton label="Search" disabled={text.trim().length < 2} onClick={() => void run()}>
          <Search size={14} />
        </ToolButton>
        {hits && (
          <ToolButton
            label="Clear the search"
            onClick={() => {
              setText('');
              setHits(undefined);
            }}
          >
            <X size={14} />
          </ToolButton>
        )}
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
  onRemove,
  onAudioDeleted,
}: {
  item: RecordingItem;
  dm: boolean;
  transcript: boolean;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onAudioDeleted: () => void;
}) {
  const live = item.status === 'recording' || item.status === 'processing';
  return (
    <section className="vtt-session">
      <div className="vtt-session-top">
        <button type="button" className="vtt-char-head" aria-expanded={open} onClick={onToggle}>
          <span className="vtt-char-text">
            <b>{dateOf(item.startedAt)}</b>
            <span className="vtt-muted">
              {durationLabel(item.startedAt, item.stoppedAt)}
              {item.status !== 'processed' ? ` · ${statusWord(item.status)}` : ''}
              {item.summaries.length > 0 ? ` · ${item.summaries.map(summaryLabel).join(', ')}` : ''}
              {dm && item.audio === 'purged' ? ' · audio deleted' : ''}
            </span>
          </span>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {dm && !live && (
          <SessionDelete
            id={item.id}
            canDeleteAudio={audioActions(item, dm).canDelete}
            onAudioDeleted={onAudioDeleted}
            onRemoved={onRemove}
          />
        )}
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
  const [summaries, setSummaries] = useState<SummaryView[]>();
  const [error, setError] = useState<string>();
  const [transcript, setTranscript] = useState<TranscriptRow[]>();
  // The scribe's notes come to the DM alone and stay folded away: the tale and the brief are what is read.
  const [showNotes, setShowNotes] = useState(false);
  const notes = summaries?.filter((s) => s.kind === 'notes') ?? [];
  useEffect(() => {
    let cancelled = false;
    campaignApi<{ summaries: SummaryView[] }>('GET', `recordings/${id}`)
      .then((d) => !cancelled && setSummaries(d.summaries))
      .catch((e) => !cancelled && setError(accountErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function loadTranscript() {
    try {
      const d = await campaignApi<{ utterances: Utterance[]; markers?: SceneMarker[] }>(
        'GET',
        `recordings/${id}/transcript`,
      );
      setTranscript(transcriptRows(d.utterances, d.markers));
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }

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
      {summaries
        ?.filter((s) => s.kind !== 'notes' || showNotes)
        .map((s, i) => (
          <article key={i} className="vtt-session">
            <b>
              {summaryLabel(s.kind)}
              {s.subject ? `: ${s.subject}` : ''}
              {s.title ? ` · ${s.title}` : ''}
            </b>
            <MarkdownView text={s.text} />
          </article>
        ))}
      {notes.length > 0 && (
        <div>
          <ToolButton
            label={showNotes ? 'Hide the scribe’s notes' : 'Show the scribe’s notes'}
            text="Scribe’s notes"
            onClick={() => setShowNotes((v) => !v)}
          >
            {showNotes ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </ToolButton>
        </div>
      )}
      {transcript ? (
        <div className="vtt-transcript">
          {transcript.length === 0 && <span className="vtt-muted">No transcript yet.</span>}
          {transcript.map((row, i) =>
            row.kind === 'scene' ? (
              <p
                key={i}
                className="vtt-muted"
                style={{ borderBlockStart: '1px solid currentColor' }}
              >
                {clock(row.atMs)} · <b>Scene: {row.name}</b>
              </p>
            ) : (
              <p key={i}>
                <span className="vtt-muted">{clock(row.line.startMs)}</span>{' '}
                <b>{speakerName(row.line.speaker)}</b>
                {row.line.typed ? <span className="vtt-muted"> (typed)</span> : null}{' '}
                {row.line.text}
              </p>
            ),
          )}
        </div>
      ) : !canReadTranscript ? null : (
        <div>
          <ToolButton
            label="Show the full transcript"
            text="Transcript"
            onClick={() => void loadTranscript()}
          >
            <ChevronRight size={14} />
          </ToolButton>
        </div>
      )}
    </div>
  );
}
