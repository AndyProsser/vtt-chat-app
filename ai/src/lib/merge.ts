import { DEFAULT_COALESCE_GAP_MS } from '../consts/index.js';
import type { TrackTranscript, Utterance } from '../types/index.js';

export interface MergeOptions {
  coalesceGapMs?: number;
}

/**
 * Merges per-speaker transcripts into one timeline.
 *
 * **Private tracks are dropped here, unconditionally** — this is the last line of defence for the
 * rule that whispers never reach a shared artifact (the first is that they aren't recorded).
 *
 * Neighbouring lines by the same speaker are joined when they are close together, so a sentence
 * Whisper split in two reads as one line. Lines from different speakers are never joined, so
 * crosstalk stays visible in order.
 */
export function mergeTranscripts(
  tracks: readonly TrackTranscript[],
  options: MergeOptions = {},
): Utterance[] {
  const gap = options.coalesceGapMs ?? DEFAULT_COALESCE_GAP_MS;

  const all: Utterance[] = [];
  for (const track of tracks) {
    if (track.private) continue;
    for (const segment of track.segments) {
      all.push({
        speaker: track.speaker,
        startMs: segment.startMs + track.startOffsetMs,
        endMs: segment.endMs + track.startOffsetMs,
        text: segment.text,
      });
    }
  }

  all.sort(
    (a, b) =>
      a.startMs - b.startMs || a.endMs - b.endMs || a.speaker.id.localeCompare(b.speaker.id),
  );

  const merged: Utterance[] = [];
  for (const utterance of all) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.speaker.id === utterance.speaker.id &&
      utterance.startMs - previous.endMs <= gap
    ) {
      previous.text = `${previous.text} ${utterance.text}`;
      previous.endMs = Math.max(previous.endMs, utterance.endMs);
    } else {
      merged.push({ ...utterance });
    }
  }
  return merged;
}
