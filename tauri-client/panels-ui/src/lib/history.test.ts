import { describe, expect, it } from 'vitest';

import {
  audioActions,
  audioDeletionNote,
  clock,
  durationLabel,
  snippetParts,
  speakerName,
  summaryLabel,
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
    expect(summaryLabel('dm-only')).toBe('DM only');
    expect(summaryLabel('odd')).toBe('odd');
  });
});

describe('speakerName', () => {
  it('reads the name from the {id, name} the server sends, and tolerates a plain string', () => {
    expect(speakerName({ id: 'u1', name: 'Aria' })).toBe('Aria');
    expect(speakerName('Bruno')).toBe('Bruno');
  });
});

describe('audioActions', () => {
  const rec = (status: string, audio?: 'kept' | 'purged' | 'partly' | 'none') => ({
    id: 'r',
    startedAt: 0,
    stoppedAt: 1,
    status,
    summaries: [],
    ...(audio ? { audio } : {}),
  });
  it('offers the DM to delete the audio of a processed recording that still has some', () => {
    expect(audioActions(rec('processed', 'kept'), true).canDelete).toBe(true);
    expect(audioActions(rec('processed', 'partly'), true).canDelete).toBe(true);
  });
  it('does not, for a player, a recording still being processed, or audio that is gone', () => {
    expect(audioActions(rec('processed', 'kept'), false).canDelete).toBe(false);
    expect(audioActions(rec('processing', 'kept'), true).canDelete).toBe(false);
    expect(audioActions(rec('processed', 'purged'), true).canDelete).toBe(false);
    expect(audioActions(rec('processed', 'none'), true).canDelete).toBe(false);
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
