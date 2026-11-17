import { describe, expect, it } from 'vitest';

import type { RecordingEvent } from '../types/index.js';
import { compactCues, eventCues } from './cues.js';
import { formatCue } from './format.js';
import { buildBriefPrompt, buildNotesPrompt, buildStoryPrompt } from './prompts.js';
import { planSummaries } from './summaryPlan.js';

const loot = (at: number, detail: Record<string, unknown>): RecordingEvent => ({
  recordingId: 'r',
  at,
  event: 'loot',
  detail,
});
const item = { quantity: 1, kind: 'item', itemType: 'weapon', rarity: null };
const events = [
  loot(1000, { action: 'dropped', name: 'Rope', ...item }),
  loot(2000, { action: 'taken', name: 'Rope', ...item, by: 'Bram' }),
  loot(3000, { action: 'given', name: 'Vorpal Sword', ...item, rarity: 'legendary', to: 'Aria' }),
  loot(4000, {
    action: 'split',
    name: 'gp',
    quantity: 240,
    kind: 'coin',
    itemType: 'coin',
    rarity: null,
    shares: [
      { name: 'Aria', amount: 120 },
      { name: 'Bram', amount: 120 },
    ],
    remainder: 0,
  }),
  loot(5000, {
    action: 'stored',
    name: 'Black pearl (500 gp)',
    ...item,
    itemType: 'gem',
    by: 'Cassiel',
  }),
  loot(6000, {
    action: 'taken',
    name: 'sp',
    quantity: 30,
    kind: 'coin',
    itemType: 'coin',
    rarity: null,
    by: 'Dorn',
  }),
  loot(7000, { action: 'returned', name: 'Rope', ...item }),
  loot(8000, { action: 'removed', name: 'Rope', ...item }),
];

describe('loot cues', () => {
  const cues = eventCues(events, 0);

  it('says who got what, in plain words', () => {
    expect(cues.map((c) => c.text)).toEqual([
      'Loot dropped: Rope',
      'Bram took Rope',
      'The Game Master gave Vorpal Sword (legendary) to Aria',
      '240 gp was split: Aria 120, Bram 120',
      'Cassiel put Black pearl (500 gp) in the party stash',
      'Dorn took 30 sp',
      'Rope was put back on the table',
      'The Game Master took Rope off the table',
    ]);
    expect(cues.every((c) => c.kind === 'loot')).toBe(true);
  });

  it('marks as notable only treasure that someone received and that is worth telling', () => {
    expect(cues.filter((c) => c.notable).map((c) => c.atMs)).toEqual([3000, 4000, 5000]);
  });

  it('shows as a (loot) line in the transcript', () => {
    expect(formatCue(cues[1]!)).toBe('[0:00:02] (loot) Bram took Rope');
  });

  it('is never cut when the cue list is trimmed', () => {
    const effects = Array.from({ length: 60 }, (_, i) => ({
      atMs: i,
      kind: 'effect' as const,
      text: `Sound effect: "s${i}"`,
    }));
    const kept = compactCues([...effects, ...cues], 10);
    expect(kept.filter((c) => c.kind === 'loot')).toHaveLength(8);
  });
});

describe('loot in the summaries', () => {
  const utterances = [
    { speaker: { id: 'dm', name: 'Mira' }, startMs: 500, endMs: 900, text: 'You find treasure.' },
    { speaker: { id: 'p1', name: 'Aria' }, startMs: 9000, endMs: 9500, text: 'Mine!' },
  ];
  const plan = planSummaries({
    utterances,
    events,
    startedAt: 0,
    playerIds: new Set(['p1']),
  });
  const session = plan.find((p) => p.kind === 'session')!;
  const brief = plan.find((p) => p.kind === 'dm-only')!;

  it('gives every summary the full loot record and the notable part', () => {
    expect(brief.context.loot?.all).toHaveLength(8);
    expect(session.context.loot?.notable).toEqual([
      'The Game Master gave Vorpal Sword (legendary) to Aria',
      '240 gp was split: Aria 120, Bram 120',
      'Cassiel put Black pearl (500 gp) in the party stash',
    ]);
  });

  it('tells the scribe that loot lines are facts to note', () => {
    expect(buildNotesPrompt('x', 0, 1, session.context)).toMatch(/"\(loot\)".*facts/);
  });

  it("gives the Game Master's brief the whole record", () => {
    const prompt = buildBriefPrompt(['notes'], brief.context);
    expect(prompt).toContain('Bram took Rope');
    expect(prompt).toContain('Dorn took 30 sp');
  });

  it("puts only the notable loot in the players' tale", () => {
    const prompt = buildStoryPrompt('session', ['notes'], session.context);
    expect(prompt).toContain('Vorpal Sword (legendary)');
    expect(prompt).not.toContain('Dorn took 30 sp');
    expect(prompt).toMatch(/leave all other loot out/i);
  });

  it('says nothing about loot when there was none', () => {
    const bare = planSummaries({
      utterances,
      events: [],
      startedAt: 0,
      playerIds: new Set(['p1']),
    });
    const s = bare.find((p) => p.kind === 'session')!;
    expect(s.context.loot).toBeUndefined();
    expect(buildStoryPrompt('session', ['notes'], s.context)).not.toMatch(/loot/i);
  });
});
