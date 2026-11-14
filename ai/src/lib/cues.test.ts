import { describe, expect, it } from 'vitest';

import type { RecordingEvent, SummaryCue } from '../types/index.js';
import { compactCues, eventCues } from './cues.js';
import { formatTimeline } from './format.js';
import { buildChunkPrompt, buildSinglePrompt } from './prompts.js';
import { summarise } from './summarise.js';
import { planChapters } from './chapters.js';
import { planSummaries } from './summaryPlan.js';

const ev = (
  at: number,
  event: RecordingEvent['event'],
  detail?: Record<string, unknown>,
): RecordingEvent => ({ recordingId: 'r', at, event, ...(detail ? { detail } : {}) });
const scene = (at: number, name: string, ambience?: string[]) =>
  ev(at, 'scene', { action: 'start', sceneId: name, name, ...(ambience ? { ambience } : {}) });
const talk = (startMs: number, seconds: number, id = 'dm', name = 'Narrator') => ({
  speaker: { id, name },
  startMs,
  endMs: startMs + seconds * 1000,
  text: `${name} talks at ${startMs}`,
});

describe('eventCues', () => {
  it('turns scene, sound, voice and group events into cues on the recording clock', () => {
    const cues = eventCues(
      [
        scene(1100, 'Drowned Crypt', ['Dripping', 'Eerie hum']),
        ev(2100, 'sound', {
          action: 'play',
          name: 'Door creak',
          category: 'effect',
          mode: 'oneshot',
        }),
        ev(3100, 'sound', { action: 'play', name: 'Wind', category: 'ambience', mode: 'loop' }),
        ev(4100, 'sound', { action: 'stop', name: 'Wind' }),
        ev(5100, 'voice', { voice: 'dragon', by: 'Dana' }),
        ev(6100, 'group', { groups: [{ name: 'Cave', members: ['Aria', 'Bram'] }] }),
        ev(7100, 'group', { groups: [] }),
      ],
      100,
    );
    expect(cues.map((c) => [c.atMs, c.kind, c.text])).toEqual([
      [1000, 'scene', 'Scene started: "Drowned Crypt" (sounds: Dripping, Eerie hum)'],
      [2000, 'effect', 'Sound effect: "Door creak" (effect)'],
      [3000, 'effect', 'Loop started: "Wind" (ambience)'],
      [4000, 'effect', 'Loop stopped: "Wind"'],
      [5000, 'voice', 'Dana switched to the character voice "dragon"'],
      [
        6000,
        'group',
        'The table split into groups: "Cave" (Aria, Bram); anyone not listed stayed at the main table',
      ],
      [7000, 'group', 'The groups were merged: everyone is back at the main table'],
    ]);
  });

  it('treats a stop right before a start as one scene change, and drops malformed events', () => {
    const cues = eventCues(
      [
        ev(1000, 'scene', { action: 'stop' }),
        scene(1001, 'Tavern'),
        ev(9000, 'scene', { action: 'stop' }),
        ev(9500, 'voice', {}),
        ev(9600, 'sound', { action: 'play' }),
      ],
      0,
    );
    expect(cues.map((c) => c.text)).toEqual(['Scene started: "Tavern"', 'The scene ended']);
  });
});

describe('compactCues', () => {
  it('collapses repeated effects to one line with a count', () => {
    const cue = (atMs: number): SummaryCue => ({
      atMs,
      kind: 'effect',
      text: 'Sound effect: "Drip"',
    });
    expect(compactCues([cue(1), cue(2), cue(3)])).toEqual([
      { atMs: 1, kind: 'effect', text: 'Sound effect: "Drip" (3 times)' },
    ]);
  });

  it('stays bounded, keeping scenes and groups ahead of effects, and says what it left out', () => {
    const cues: SummaryCue[] = [
      ...Array.from({ length: 100 }, (_, i) => ({
        atMs: i,
        kind: 'effect' as const,
        text: `Sound effect: "S${i}"`,
      })),
      { atMs: 500, kind: 'scene', text: 'Scene started: "Crypt"' },
      {
        atMs: 600,
        kind: 'group',
        text: 'The groups were merged: everyone is back at the main table',
      },
    ];
    const out = compactCues(cues, 10);
    expect(out).toHaveLength(10);
    expect(out.some((c) => c.text.includes('Crypt'))).toBe(true);
    expect(out.some((c) => c.kind === 'group')).toBe(true);
    expect(out.at(-1)?.text).toMatch(/more minor cues left out/);
  });
});

describe('planChapters', () => {
  const base = { startedAt: 0, events: [] as RecordingEvent[] };
  it('starts a chapter at a scene change when it holds enough speech, titled with the scene', () => {
    const chapters = planChapters({
      ...base,
      events: [scene(120_000, 'Drowned Crypt')],
      utterances: [talk(0, 100), talk(121_000, 90)],
    });
    expect(chapters).toEqual([
      { number: 1, startMs: 0, endMs: 120_000 },
      { number: 2, startMs: 120_000, endMs: Number.POSITIVE_INFINITY, title: 'Drowned Crypt' },
    ]);
  });

  it('folds a short scene chapter into the one before it (a DM flipping scenes)', () => {
    const chapters = planChapters({
      ...base,
      events: [scene(100_000, 'A'), scene(110_000, 'B'), scene(200_000, 'C')],
      utterances: [talk(0, 90), talk(101_000, 5), talk(111_000, 80), talk(201_000, 70)],
    });
    expect(chapters.map((c) => [c.startMs, c.title])).toEqual([
      [0, undefined],
      [110_000, 'B'],
      [200_000, 'C'],
    ]);
  });

  it('keeps a pause chapter however short, carries the running scene, and ends the title with the scene', () => {
    const chapters = planChapters({
      ...base,
      events: [
        scene(0, 'Inn'),
        ev(50_000, 'paused'),
        ev(60_000, 'resumed'),
        ev(70_000, 'scene', { action: 'stop' }),
        ev(80_000, 'resumed'),
      ],
      utterances: [talk(1000, 5), talk(61_000, 5), talk(81_000, 5)],
    });
    expect(chapters.map((c) => c.title)).toEqual(['Inn', 'Inn', undefined]);
  });

  it('makes one chapter when nothing splits the recording', () => {
    expect(planChapters({ ...base, utterances: [talk(0, 10)] })).toHaveLength(1);
  });
});

describe('planSummaries with cues', () => {
  it('gives each chapter its scene title and only its own cues; session and characters get all', () => {
    const events = [
      scene(120_000, 'Drowned Crypt', ['Dripping']),
      ev(10_000, 'sound', { action: 'play', name: 'Thunder', mode: 'oneshot' }),
    ];
    const utterances = [talk(0, 100), talk(121_000, 90), talk(150_000, 20, 'p1', 'Aria')];
    const plan = planSummaries({
      utterances,
      events,
      startedAt: 0,
      playerIds: new Set(['p1']),
    });
    const chapters = plan.filter((p) => p.kind === 'chapter');
    expect(chapters.map((c) => c.context.chapter)).toEqual([
      { number: 1, of: 2 },
      { number: 2, of: 2, title: 'Drowned Crypt' },
    ]);
    expect(chapters[0]?.context.cues?.map((c) => c.kind)).toEqual(['effect']);
    expect(chapters[1]?.context.cues?.map((c) => c.kind)).toEqual(['scene']);
    expect(plan.find((p) => p.kind === 'session')?.context.cues).toHaveLength(2);
    expect(plan.find((p) => p.kind === 'character')?.context.cues).toHaveLength(2);
  });
});

describe('prompts with cues', () => {
  const cues: SummaryCue[] = [
    { atMs: 5000, kind: 'scene', text: 'Scene started: "Drowned Crypt" (sounds: Dripping)' },
  ];
  const lines = formatTimeline([talk(1000, 2), talk(9000, 2)], cues);

  it('weaves cues among the transcript lines by time', () => {
    expect(lines).toEqual([
      '[0:00:01] Narrator: Narrator talks at 1000',
      '[0:00:05] (cue) Scene started: "Drowned Crypt" (sounds: Dripping)',
      '[0:00:09] Narrator: Narrator talks at 9000',
    ]);
  });

  it('puts the cue-not-fact rule in the prompt only when there are cues', () => {
    const withCues = buildSinglePrompt('session', lines.join('\n'), { cues });
    expect(withCues).toContain('(cue) Scene started: "Drowned Crypt"');
    expect(withCues).toMatch(/not events: do not invent/);
    expect(buildChunkPrompt('session', 'x', 0, 2, { cues })).toMatch(/cues noted by the app/);
    expect(buildSinglePrompt('session', 'x', {})).not.toMatch(/cue/);
  });

  it('names the chapter scene, and the model sees the cue lines when summarising', async () => {
    const seen: string[] = [];
    await summarise(
      async (p) => {
        seen.push(p);
        return 'ok';
      },
      [talk(1000, 2)],
      {
        kind: 'chapter',
        context: { chapter: { number: 2, of: 3, title: 'Drowned Crypt' }, cues },
      },
    );
    expect(seen[0]).toContain('which began in the scene "Drowned Crypt"');
    expect(seen[0]).toContain('(cue) Scene started');
  });
});
