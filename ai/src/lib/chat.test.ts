import { describe, expect, it } from 'vitest';

import type { RecordingEvent, Utterance } from '../types/index.js';
import { chatUtterances, mergeTimeline } from './chat.js';
import { formatUtterance } from './format.js';

const chat = (at: number, text: string, extra: Record<string, unknown> = {}): RecordingEvent => ({
  recordingId: 'r',
  at,
  event: 'chat',
  detail: { senderId: 'u1', senderName: 'Aria', text, ...extra },
});

describe('chatUtterances', () => {
  it('turns typed lines into utterances on the recording clock', () => {
    const lines = chatUtterances([chat(5_000, 'Anyone smell brine?')], 2_000);
    expect(lines).toEqual([
      {
        speaker: { id: 'u1', name: 'Aria' },
        startMs: 3_000,
        endMs: 3_000,
        text: 'Anyone smell brine?',
        typed: true,
      },
    ]);
  });

  it('never includes a whisper, however it got into the events', () => {
    expect(chatUtterances([chat(5_000, 'psst', { to: 'u2' })], 0)).toEqual([]);
    expect(chatUtterances([chat(5_000, 'psst', { recipientId: 'u2' })], 0)).toEqual([]);
  });

  it('never includes an out-of-character line, even if one reached the timeline', () => {
    expect(chatUtterances([chat(5_000, 'pizza is here', { kind: 'ooc' })], 0)).toEqual([]);
    const kept = chatUtterances(
      [chat(1_000, 'Stand fast', { kind: 'say' }), chat(2_000, 'draws a dagger', { kind: 'do' })],
      0,
    );
    expect(kept.map((u) => u.text)).toEqual(['Stand fast', 'draws a dagger']);
  });

  it('ignores other events and malformed chat', () => {
    const odd: RecordingEvent[] = [
      { recordingId: 'r', at: 1, event: 'started' },
      { recordingId: 'r', at: 2, event: 'chat' },
      { recordingId: 'r', at: 3, event: 'chat', detail: { text: 5 } },
    ];
    expect(chatUtterances(odd, 0)).toEqual([]);
  });
});

describe('mergeTimeline', () => {
  const said = (startMs: number, text: string): Utterance => ({
    speaker: { id: 'u2', name: 'Bram' },
    startMs,
    endMs: startMs + 500,
    text,
  });

  it('puts typed lines among the spoken ones by time, and never joins them', () => {
    const typed = chatUtterances([chat(1_500, 'one'), chat(1_600, 'two')], 0);
    const merged = mergeTimeline([said(1_000, 'hello'), said(2_000, 'bye')], typed);
    expect(merged.map((u) => u.text)).toEqual(['hello', 'one', 'two', 'bye']);
  });

  it('keeps the order stable when nothing is typed', () => {
    const speech = [said(1_000, 'a'), said(2_000, 'b')];
    expect(mergeTimeline(speech, [])).toEqual(speech);
  });
});

describe('formatUtterance', () => {
  it('marks a typed line, so a reader and a summary can tell it from speech', () => {
    const [typed] = chatUtterances([chat(65_000, 'Hello')], 0);
    expect(formatUtterance(typed!)).toBe('[0:01:05] Aria (typed): Hello');
  });
});
