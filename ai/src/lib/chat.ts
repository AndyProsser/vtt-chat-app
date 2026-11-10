import type { RecordingEvent } from '../types/records.js';
import type { Utterance } from '../types/index.js';

/**
 * The lines people typed into the table's public chat while a recording ran, as utterances on the
 * recording's clock (`startedAt` is when the recording began).
 *
 * **Whispers are never included.** The server never stores one as a chat event; this refuses any event
 * that names a recipient anyway, as the last line of defence (CLAUDE.md §8.4).
 */
export function chatUtterances(events: readonly RecordingEvent[], startedAt: number): Utterance[] {
  const lines: Utterance[] = [];
  for (const event of events) {
    if (event.event !== 'chat' || !event.detail) continue;
    const { senderId, senderName, text, to, recipientId } = event.detail;
    if (to !== undefined || recipientId !== undefined) continue;
    if (typeof text !== 'string' || text.trim() === '') continue;
    if (typeof senderId !== 'string' || typeof senderName !== 'string') continue;
    const at = Math.max(0, event.at - startedAt);
    lines.push({
      speaker: { id: senderId, name: senderName },
      startMs: at,
      endMs: at,
      text: text.trim(),
      typed: true,
    });
  }
  return lines;
}

/** Spoken and typed lines on one timeline. Typed lines are never joined to anything. */
export function mergeTimeline(
  speech: readonly Utterance[],
  typed: readonly Utterance[],
): Utterance[] {
  if (typed.length === 0) return [...speech];
  // A stable sort: lines at the same moment keep speech first, then typing in the order it arrived.
  return [...speech, ...typed].sort((a, b) => a.startMs - b.startMs);
}
