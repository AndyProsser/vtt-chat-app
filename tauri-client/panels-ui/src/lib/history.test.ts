import { describe, expect, it } from 'vitest';

import {
  audioDeletionNote,
  canDeleteSession,
  clock,
  durationLabel,
  shownHits,
  snippetParts,
  speakerName,
  summaryLabel,
  transcriptRows,
} from './history.js';

describe('durationLabel', () => {
  it('reads naturally across the ranges', () => {
    expect(durationLabel(0, null)).toBe('still going');
    expect(durationLabel(0, 20_000)).toBe('under a minute');
    expect(durationLabel(0, 45 * 60_000)).toBe('45 min');
    expect(durationLabel(0, 125 * 60_000)).toBe('2 h 05 min');
  });
});

describe('clock', () => {
  it('shows minutes and seconds, with hours when needed', () => {
    expect(clock(5_000)).toBe('0:05');
    expect(clock(309_000)).toBe('5:09');
    expect(clock(3_909_000)).toBe('1:05:09');
  });
});

describe('snippetParts', () => {
  it('splits marks from text and decodes entities, never producing markup', () => {
    expect(snippetParts('the <mark>dragon</mark> &amp; the &lt;b&gt; knight')).toEqual([
      { text: 'the ', mark: false },
      { text: 'dragon', mark: true },
      { text: ' & the <b> knight', mark: false },
    ]);
    expect(snippetParts('no hits')).toEqual([{ text: 'no hits', mark: false }]);
  });
});

describe('summaryLabel', () => {
  it('names the kinds and passes unknown ones through', () => {
    expect(summaryLabel('dm-only')).toBe('DM brief');
    expect(summaryLabel('notes')).toBe('Scribe’s notes');
    expect(summaryLabel('odd')).toBe('odd');
  });
});

describe('speakerName', () => {
  it('reads the name from the {id, name} the server sends, and tolerates a plain string', () => {
    expect(speakerName({ id: 'u1', name: 'Aria' })).toBe('Aria');
    expect(speakerName('Bruno')).toBe('Bruno');
  });
});

describe('canDeleteSession', () => {
  const MIN = 60_000;
  const rec = (minutes: number | null, status = 'processed') => ({
    startedAt: 0,
    stoppedAt: minutes === null ? null : minutes * MIN,
    status,
  });
  it('offers any DM a short finished session, with or without dev builds', () => {
    expect(canDeleteSession(rec(5), true, false)).toBe(true);
    expect(canDeleteSession(rec(29), true, true)).toBe(true);
  });
  it('offers a long session only with dev builds on (the server must be in dev mode too)', () => {
    expect(canDeleteSession(rec(30), true, true)).toBe(true);
    expect(canDeleteSession(rec(240), true, true)).toBe(true);
    expect(canDeleteSession(rec(30), true, false)).toBe(false);
    expect(canDeleteSession(rec(240), true, false)).toBe(false);
  });
  it('never for a player, or while it is running or being processed', () => {
    expect(canDeleteSession(rec(5), false, true)).toBe(false);
    expect(canDeleteSession(rec(null, 'recording'), true, true)).toBe(false);
    expect(canDeleteSession(rec(5, 'processing'), true, true)).toBe(false);
  });
});

describe('audioDeletionNote', () => {
  it('says when the audio will go, for the DM only', () => {
    const on = new Date(2026, 10, 13).getTime();
    expect(audioDeletionNote({ audioDeletedOn: on }, true, 'en-AU')).toMatch(/13 Nov/);
    expect(audioDeletionNote({ audioDeletedOn: on }, false, 'en-AU')).toBeNull();
    expect(audioDeletionNote({}, true, 'en-AU')).toBeNull();
  });
});

describe('shownHits', () => {
  const hits = [
    { recordingId: 'r', source: 'transcript' as const, snippet: 'a' },
    { recordingId: 'r', source: 'chat' as const, snippet: 'b' },
    { recordingId: 'r', source: 'summary' as const, kind: 'session', snippet: 'c' },
  ];
  it('keeps only the summaries unless the transcript is shown', () => {
    expect(shownHits(hits, false).map((h) => h.source)).toEqual(['summary']);
    expect(shownHits(hits, true)).toHaveLength(3);
  });
});

describe('transcriptRows', () => {
  const line = (startMs: number, text: string) => ({
    speaker: 'Aria',
    startMs,
    endMs: startMs + 500,
    text,
  });
  it('puts a scene divider among the lines by time, before the lines at its moment', () => {
    const rows = transcriptRows(
      [line(0, 'one'), line(5000, 'two')],
      [{ atMs: 5000, kind: 'scene', text: 'Drowned Crypt' }],
    );
    expect(rows.map((r) => (r.kind === 'scene' ? `Scene: ${r.name}` : r.line.text))).toEqual([
      'one',
      'Scene: Drowned Crypt',
      'two',
    ]);
  });
});
