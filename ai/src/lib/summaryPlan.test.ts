import { describe, expect, it } from 'vitest';

import type { RecordingEvent, Utterance } from '../types/index.js';
import { chapterStarts, planSummaries } from './summaryPlan.js';

const ev = (at: number, event: RecordingEvent['event']): RecordingEvent => ({
  recordingId: 'r',
  at,
  event,
});
const line = (id: string, name: string, startMs: number, typed = false): Utterance => ({
  speaker: { id, name },
  startMs,
  endMs: startMs + 500,
  text: `${name} at ${startMs}`,
  ...(typed ? { typed: true } : {}),
});

describe('chapterStarts', () => {
  it('starts a chapter at the beginning and at every resume, on the recording clock', () => {
    const events = [ev(100, 'started'), ev(600, 'paused'), ev(900, 'resumed'), ev(2100, 'resumed')];
    expect(chapterStarts(events, 100)).toEqual([0, 800, 2000]);
  });
});

describe('planSummaries', () => {
  const players = new Set(['p1', 'p2']);
  const base = { startedAt: 0, playerIds: players, campaignName: 'C' };

  it('plans only session and DM-only when there is nothing to summarise', () => {
    const plan = planSummaries({ ...base, utterances: [], events: [] });
    expect(plan.map((p) => p.kind)).toEqual(['session', 'dm-only']);
  });

  it('makes no chapters for an unpaused recording, and a character summary per speaking player', () => {
    const utterances = [line('dm', 'Narrator', 0), line('p1', 'Aria', 10), line('p2', 'Bram', 20)];
    const plan = planSummaries({ ...base, utterances, events: [ev(0, 'started')] });
    expect(plan.map((p) => `${p.kind}:${p.subject}`)).toEqual([
      'session:',
      'dm-only:',
      'character:Aria',
      'character:Bram',
    ]);
    expect(plan.find((p) => p.subject === 'Aria')?.context).toEqual({
      campaignName: 'C',
      gameMaster: 'Narrator',
      characterName: 'Aria',
    });
    expect(plan.find((p) => p.kind === 'dm-only')?.visibility).toBe('dm');
  });

  it('splits chapters at resumes; typing during the pause stays with the chapter before', () => {
    const utterances = [
      line('p1', 'Aria', 100),
      line('p2', 'Bram', 700, true),
      line('p1', 'Aria', 1200),
    ];
    const events = [ev(0, 'started'), ev(500, 'paused'), ev(1000, 'resumed')];
    const chapters = planSummaries({ ...base, utterances, events }).filter(
      (p) => p.kind === 'chapter',
    );
    expect(chapters.map((c) => [c.subject, c.utterances.map((u) => u.startMs)])).toEqual([
      ['1', [100, 700]],
      ['2', [1200]],
    ]);
    expect(chapters[1]?.context.chapter).toEqual({ number: 2, of: 2 });
  });

  it('skips a chapter with nothing in it but keeps the numbering', () => {
    const events = [ev(0, 'started'), ev(500, 'paused'), ev(1000, 'resumed')];
    const plan = planSummaries({ ...base, utterances: [line('p1', 'Aria', 1100)], events });
    expect(plan.filter((p) => p.kind === 'chapter').map((p) => p.subject)).toEqual(['2']);
  });

  it('uses the latest name a player had, and one summary per name', () => {
    const utterances = [
      line('p1', 'Old Hero', 0),
      line('p1', 'New Hero', 10),
      line('p2', 'New Hero', 20),
    ];
    const plan = planSummaries({ ...base, utterances, events: [] });
    expect(plan.filter((p) => p.kind === 'character').map((p) => p.subject)).toEqual(['New Hero']);
  });
});
