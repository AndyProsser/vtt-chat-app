import type { SummaryCue, Utterance } from '../types/index.js';

/** `H:MM:SS` from milliseconds. */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatUtterance(utterance: Utterance): string {
  const how = utterance.typed ? ' (typed)' : '';
  return `[${formatTimestamp(utterance.startMs)}] ${utterance.speaker.name}${how}: ${utterance.text}`;
}

/** `[H:MM:SS] (cue) text`: the form a cue takes among the transcript lines. */
export function formatCue(cue: SummaryCue): string {
  return `[${formatTimestamp(cue.atMs)}] (cue) ${cue.text}`;
}

export function formatTranscript(utterances: readonly Utterance[]): string[] {
  return utterances.map(formatUtterance);
}

/**
 * The transcript lines with the cues woven in by time (a cue comes before speech at the same moment: the
 * scene starts, then people talk). Without cues this is exactly `formatTranscript`.
 */
export function formatTimeline(
  utterances: readonly Utterance[],
  cues: readonly SummaryCue[] = [],
): string[] {
  if (cues.length === 0) return formatTranscript(utterances);
  const items = [
    ...cues.map((c) => ({ at: c.atMs, order: 0, line: formatCue(c) })),
    ...utterances.map((u) => ({ at: u.startMs, order: 1, line: formatUtterance(u) })),
  ];
  return items.sort((a, b) => a.at - b.at || a.order - b.order).map((i) => i.line);
}
