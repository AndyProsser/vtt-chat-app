import { describe, expect, it } from 'vitest';

import {
  applyMemoryUpdate,
  buildMemoryPrompt,
  MEMORY_GIST_MAX_WORDS,
  memoryLine,
  parseMemoryUpdate,
  relevantMemory,
  shortGist,
  type MemoryEntry,
} from './memory.js';

const entry = (over: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id: 'e1',
  kind: 'npc',
  name: 'Gary the Grumpy Gnome',
  aliases: ['Gary'],
  gist: 'Sells lanterns.',
  firstRecordingId: 'rec-0',
  firstSeen: 1,
  lastSeen: 1,
  timesSeen: 1,
  ...over,
});

describe('parseMemoryUpdate', () => {
  it('reads kind | name | aliases | gist lines, forgiving bullets and quoting', () => {
    const out = parseMemoryUpdate(
      'Entries:\n- npc | **Lord Ravenshade** | Ravenshade, the Lord | Rules Blackstone Keep.\n2. place | Blackstone Keep | none | A fortress.\nquest | Find the caravan | n/a | The party took it up.',
    );
    expect(out).toEqual([
      {
        kind: 'npc',
        name: 'Lord Ravenshade',
        aliases: ['Ravenshade', 'the Lord'],
        gist: 'Rules Blackstone Keep.',
      },
      { kind: 'location', name: 'Blackstone Keep', aliases: [], gist: 'A fortress.' },
      { kind: 'quest', name: 'Find the caravan', aliases: [], gist: 'The party took it up.' },
    ]);
  });

  it('keeps a stray bar in the gist, and drops lines with no good kind, name or gist', () => {
    expect(parseMemoryUpdate('item | Ring | none | Glows | when near orcs.')?.[0]?.gist).toBe(
      'Glows | when near orcs.',
    );
    expect(
      parseMemoryUpdate('weather | Rain | none | wet\nnpc |  | none | x\nnpc | Pim | none | '),
    ).toBeUndefined();
  });

  it('accepts NONE as an answer, and refuses a non-answer', () => {
    expect(parseMemoryUpdate('NONE')).toEqual([]);
    expect(parseMemoryUpdate('I am not sure what you mean.')).toBeUndefined();
  });

  it('shortens a gist to the limit at a word', () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
    expect(shortGist(long).split(' ').length).toBe(MEMORY_GIST_MAX_WORDS);
    expect(shortGist(long).endsWith('…')).toBe(true);
    expect(shortGist('short one')).toBe('short one');
  });
});

describe('relevantMemory', () => {
  const gary = entry();
  const quest = entry({
    id: 'q',
    kind: 'quest',
    name: 'Find the caravan',
    aliases: [],
    timesSeen: 3,
  });
  const pim = entry({ id: 'p', name: 'Pim', aliases: [] });

  it('finds an entry by its name or an alias, whole words, any case', () => {
    expect(relevantMemory([gary, pim], 'They found gary again.', 10).map((e) => e.id)).toEqual([
      'e1',
    ]);
    expect(relevantMemory([gary], 'The Garyoke night', 10)).toEqual([]);
    expect(relevantMemory([pim], 'Pimlico', 10)).toEqual([]);
  });

  it('adds open quests when asked, after the named ones, within the limit', () => {
    const got = relevantMemory([quest, gary], 'Gary waved.', 10, { alwaysQuests: true });
    expect(got.map((e) => e.id)).toEqual(['e1', 'q']);
    expect(relevantMemory([quest, gary], 'Gary waved.', 1, { alwaysQuests: true })).toHaveLength(1);
  });

  it('leaves out what this recording itself first taught', () => {
    const mine = entry({ firstRecordingId: 'rec-now' });
    expect(relevantMemory([mine], 'Gary', 10, { excludeFirstRecording: 'rec-now' })).toEqual([]);
  });
});

describe('applyMemoryUpdate', () => {
  let n = 0;
  const ctx = { recordingId: 'rec-1', now: 100, newId: () => `new-${(n += 1)}` };

  it('updates a known entry by name or alias and counts the session once', () => {
    const out = applyMemoryUpdate(
      [entry()],
      [
        { kind: 'npc', name: 'Gary', aliases: ['Grumpy'], gist: 'Sold a lantern.' },
        {
          kind: 'npc',
          name: 'Gary the Grumpy Gnome',
          aliases: [],
          gist: 'Sold a lantern; owes a favour.',
        },
      ],
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'e1',
      gist: 'Sold a lantern; owes a favour.',
      lastSeen: 100,
      timesSeen: 2,
      firstRecordingId: 'rec-0',
    });
    expect(out[0]?.aliases).toEqual(['Gary', 'Grumpy']);
  });

  it('makes a new entry, first seen in this recording, and learns a new name for a known one', () => {
    const out = applyMemoryUpdate(
      [entry()],
      [
        { kind: 'location', name: 'Dunmere', aliases: [], gist: 'A market town.' },
        { kind: 'npc', name: 'Gary', aliases: ['Gazza'], gist: 'Again.' },
      ],
      ctx,
    );
    const dunmere = out.find((e) => e.name === 'Dunmere');
    expect(dunmere).toMatchObject({ firstRecordingId: 'rec-1', firstSeen: 100, timesSeen: 1 });
    expect(out.find((e) => e.id === 'e1')?.aliases).toContain('Gazza');
  });

  it('does not touch an entry the update does not mention', () => {
    expect(applyMemoryUpdate([entry()], [], ctx)).toEqual([]);
  });
});

describe('prompts', () => {
  it('shows the model the known entries and the format', () => {
    const prompt = buildMemoryPrompt(['## Events\n- A.'], [entry()], { campaignName: 'Dunmere' });
    expect(prompt).toContain('kind | name | other names');
    expect(prompt).toContain(memoryLine(entry()));
    expect(prompt).toContain('"Dunmere"');
    expect(buildMemoryPrompt(['x'], [], {})).toContain('The memory is empty so far.');
  });
});
