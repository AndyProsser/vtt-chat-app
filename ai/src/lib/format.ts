import type { Utterance } from '../types/index.js';

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

export function formatTranscript(utterances: readonly Utterance[]): string[] {
  return utterances.map(formatUtterance);
}
