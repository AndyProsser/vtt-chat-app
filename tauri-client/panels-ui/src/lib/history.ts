import { DM_DELETE_MAX_MINUTES } from '@vtt-chat-app/shared';

/** Wire shapes of the records API (`/api/campaigns/:id/recordings`). */
export interface RecordingItem {
  id: string;
  startedAt: number;
  stoppedAt: number | null;
  status: string;
  summaries: string[];
  /** The DM's view of retention: is the raw audio still on the server? */
  audio?: 'kept' | 'purged' | 'partly' | 'none';
  /** When the server will delete the audio anyway to free disk space (DM only; set once the DM was warned). */
  audioDeletedOn?: number;
}
export interface SummaryView {
  kind: string;
  subject: string | null;
  visibility: 'members' | 'dm';
  text: string;
  createdAt: number;
  /** A chapter summary: the scene the chapter began in. */
  title?: string;
}
/** A scene the DM started during the recording, shown as a divider among the transcript lines. */
export interface SceneMarker {
  atMs: number;
  kind: 'scene';
  text: string;
}
/** One row of a transcript: a line, or a "Scene: <name>" divider. */
export type TranscriptRow =
  { kind: 'line'; line: Utterance } | { kind: 'scene'; atMs: number; name: string };

/** The lines with the scene markers placed among them by time (a divider comes before the lines at its moment). */
export function transcriptRows(
  lines: readonly Utterance[],
  markers: readonly SceneMarker[] = [],
): TranscriptRow[] {
  const rows = [
    ...markers.map((m) => ({
      at: m.atMs,
      order: 0,
      row: { kind: 'scene', atMs: m.atMs, name: m.text } as TranscriptRow,
    })),
    ...lines.map((line) => ({
      at: line.startMs,
      order: 1,
      row: { kind: 'line', line } as TranscriptRow,
    })),
  ];
  return rows.sort((a, b) => a.at - b.at || a.order - b.order).map((r) => r.row);
}
export interface Utterance {
  /** `{ id, name }` from the server. */
  speaker: { id: string; name: string } | string;
  startMs: number;
  endMs: number;
  text: string;
  /** Typed into the table chat during the recording, not spoken. */
  typed?: boolean;
}
export interface SearchHit {
  recordingId: string;
  source: 'transcript' | 'summary' | 'chat';
  kind?: string;
  speakerName?: string;
  atMs?: number;
  snippet: string;
}

export const SUMMARY_LABELS: Record<string, string> = {
  session: 'The tale',
  chapter: 'Chapter',
  character: 'Hero',
  'dm-only': 'DM brief',
  notes: 'Scribe’s notes',
};
export const summaryLabel = (kind: string): string => SUMMARY_LABELS[kind] ?? kind;

/** "2 h 05 min", "45 min", "under a minute"; "still going" with no stop time. */
export function durationLabel(startedAt: number, stoppedAt: number | null): string {
  if (stoppedAt === null) return 'still going';
  const minutes = Math.round(Math.max(0, stoppedAt - startedAt) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** Position in a recording as "1:05:09" or "5:09". */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};
const decode = (s: string): string => s.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m);

/**
 * Splits a search snippet (HTML-escaped text with `<mark>…</mark>` around the hits) into plain text
 * parts, so it can be shown as React text and never as markup.
 */
export function snippetParts(snippet: string): { text: string; mark: boolean }[] {
  const parts: { text: string; mark: boolean }[] = [];
  const re = /<mark>(.*?)<\/mark>/gs;
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    if (m.index > last) parts.push({ text: decode(snippet.slice(last, m.index)), mark: false });
    parts.push({ text: decode(m[1] ?? ''), mark: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: decode(snippet.slice(last)), mark: false });
  return parts;
}

/**
 * The search hits this person is shown. Lines from the transcript (spoken or typed) are for a DM with dev
 * builds on, like the transcript itself; the server already keeps them from players.
 */
export const shownHits = (hits: readonly SearchHit[], transcript: boolean): SearchHit[] =>
  hits.filter((h) => transcript || h.source === 'summary');

/** The name to show for an utterance's speaker. */
export const speakerName = (speaker: Utterance['speaker']): string =>
  typeof speaker === 'string' ? speaker : speaker.name;

/**
 * Whether the DM is offered "Delete this session": only with dev builds on (the app's own rule), only for a
 * session that is over and shorter than `DM_DELETE_MAX_MINUTES` (the server's rule). The raw audio is never the
 * DM's to delete: the operator's retention settings and `vtt-admin` do that (Andy, 2026-11-18).
 */
export function canDeleteSession(
  item: Pick<RecordingItem, 'status' | 'startedAt' | 'stoppedAt'>,
  dm: boolean,
  devBuilds: boolean,
): boolean {
  if (!dm || item.stoppedAt === null) return false;
  if (item.status === 'recording' || item.status === 'processing') return false;
  if (item.stoppedAt - item.startedAt < DM_DELETE_MAX_MINUTES * 60_000) return true;
  // A longer session: the button shows only with dev builds on, and the server must be in dev mode too, or it refuses.
  return devBuilds;
}

/** "The audio will be deleted on Fri 13 Nov to free disk space", for the DM; null when not due. */
export function audioDeletionNote(
  item: Pick<RecordingItem, 'audioDeletedOn'>,
  dm: boolean,
  locale?: string,
): string | null {
  if (!dm || item.audioDeletedOn === undefined) return null;
  const day = new Date(item.audioDeletedOn).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `The server will delete this session's audio on ${day} to free disk space. The transcript and summaries stay.`;
}
