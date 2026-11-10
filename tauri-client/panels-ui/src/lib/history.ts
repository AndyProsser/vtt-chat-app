/** Wire shapes of the records API (`/api/campaigns/:id/recordings`). */
export interface RecordingItem {
  id: string;
  startedAt: number;
  stoppedAt: number | null;
  status: string;
  summaries: string[];
  /** The DM's view of retention: is the raw audio still on the server? */
  audio?: 'kept' | 'purged' | 'partly' | 'none';
}
export interface SummaryView {
  kind: string;
  subject: string | null;
  visibility: 'members' | 'dm';
  text: string;
  createdAt: number;
}
export interface Utterance {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}
export interface SearchHit {
  recordingId: string;
  source: 'transcript' | 'summary';
  kind?: string;
  speakerName?: string;
  atMs?: number;
  snippet: string;
}

export const SUMMARY_LABELS: Record<string, string> = {
  session: 'Session summary',
  character: 'Character',
  'dm-only': 'DM only',
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
