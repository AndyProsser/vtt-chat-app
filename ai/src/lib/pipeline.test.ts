import { describe, expect, it, vi } from 'vitest';

import type { TrackTranscript, Utterance } from '../types/index.js';
import { chunkLines } from './chunk.js';
import { formatTimestamp, formatUtterance } from './format.js';
import { mergeTranscripts } from './merge.js';
import { createOllamaGenerate } from './ollama.js';
import { buildBriefPrompt, buildNotesPrompt, buildStoryPrompt, taleWords } from './prompts.js';
import {
  groupByBudget,
  stripThinking,
  summarise,
  takeNotes,
  tidyTale,
  writeFromNotes,
} from './summarise.js';
import { isNonSpeech, parseWhisperJson } from './whisperJson.js';

const alice = { id: 'alice', name: 'Aria (Alice)' };
const bob = { id: 'bob', name: 'Bruno (Bob)' };

describe('stripThinking', () => {
  it('keeps only the answer of a reasoning model that thought aloud', () => {
    expect(stripThinking('<think>\nthe user wants…\n</think>\n\n## Summary\nThey won.')).toBe(
      '## Summary\nThey won.',
    );
    // A server that dropped the opening tag but kept the closing one.
    expect(stripThinking('hmm, let me see</think>The answer')).toBe('The answer');
    expect(stripThinking('  plain summary  ')).toBe('plain summary');
  });

  it('is applied to every model call a summary makes', async () => {
    const generate = async () => '<think>secret reasoning</think>The party won.';
    const result = await summarise(
      generate,
      [{ speaker: alice, startMs: 0, endMs: 1, text: 'hi' }],
      {
        kind: 'session',
      },
    );
    expect(result.text).toBe('The party won.');
  });
});

describe('parseWhisperJson', () => {
  it('reads offsets and trims text, skipping non-speech markers', () => {
    const segments = parseWhisperJson({
      transcription: [
        { offsets: { from: 0, to: 1500 }, text: ' I open the door. ' },
        { offsets: { from: 1500, to: 3000 }, text: ' [BLANK_AUDIO]' },
        { offsets: { from: 3000, to: 4000 }, text: ' (music)' },
        { offsets: { from: 4000, to: 5000 }, text: ' ♪ ' },
        { offsets: { from: 5000, to: 6000 }, text: '' },
      ],
    });
    expect(segments).toEqual([{ startMs: 0, endMs: 1500, text: 'I open the door.' }]);
  });

  it('skips malformed entries but rejects a file of the wrong shape', () => {
    expect(
      parseWhisperJson({ transcription: [{ text: 'no offsets' }, { offsets: { from: 1 } }] }),
    ).toEqual([]);
    expect(() => parseWhisperJson({})).toThrow(/transcription/);
    expect(() => parseWhisperJson({ transcription: 'x' })).toThrow(/array/);
    expect(() => parseWhisperJson(null)).toThrow();
  });

  it('classifies non-speech', () => {
    expect(isNonSpeech('[BLANK_AUDIO]')).toBe(true);
    expect(isNonSpeech('  (laughs) ')).toBe(true);
    expect(isNonSpeech('Roll for initiative')).toBe(false);
    expect(isNonSpeech('I cast (quietly) a spell')).toBe(false);
  });
});

describe('mergeTranscripts', () => {
  const tracks: TrackTranscript[] = [
    {
      speaker: alice,
      startOffsetMs: 0,
      segments: [
        { startMs: 1000, endMs: 2000, text: 'We should go' },
        { startMs: 2500, endMs: 3500, text: 'to the cellar.' },
      ],
    },
    {
      speaker: bob,
      startOffsetMs: 10_000, // Bob joined ten seconds in
      segments: [{ startMs: 0, endMs: 1000, text: 'Agreed.' }],
    },
  ];

  it('orders by shared time, applying each track offset', () => {
    const merged = mergeTranscripts(tracks);
    expect(merged.map((u) => u.speaker.id)).toEqual(['alice', 'bob']);
    expect(merged[1]?.startMs).toBe(10_000);
  });

  it('joins close lines by the same speaker, but not across speakers', () => {
    const merged = mergeTranscripts(tracks);
    expect(merged[0]?.text).toBe('We should go to the cellar.');
    expect(merged[0]?.endMs).toBe(3500);

    const crosstalk = mergeTranscripts([
      { speaker: alice, startOffsetMs: 0, segments: [{ startMs: 0, endMs: 1000, text: 'A1' }] },
      { speaker: bob, startOffsetMs: 0, segments: [{ startMs: 500, endMs: 900, text: 'B1' }] },
      { speaker: alice, startOffsetMs: 0, segments: [{ startMs: 1100, endMs: 1500, text: 'A2' }] },
    ]);
    expect(crosstalk.map((u) => u.text)).toEqual(['A1', 'B1', 'A2']);
  });

  it('never includes a private track', () => {
    const merged = mergeTranscripts([
      ...tracks,
      {
        speaker: bob,
        startOffsetMs: 0,
        private: true,
        segments: [{ startMs: 0, endMs: 1000, text: 'SECRET WHISPER' }],
      },
    ]);
    expect(JSON.stringify(merged)).not.toContain('SECRET WHISPER');
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(tracks);
    mergeTranscripts(tracks);
    expect(JSON.stringify(tracks)).toBe(before);
  });
});

describe('format', () => {
  it('formats timestamps and lines', () => {
    expect(formatTimestamp(0)).toBe('0:00:00');
    expect(formatTimestamp(3_725_000)).toBe('1:02:05');
    expect(formatTimestamp(-5)).toBe('0:00:00');
    const line: Utterance = { speaker: alice, startMs: 61_000, endMs: 62_000, text: 'Hi' };
    expect(formatUtterance(line)).toBe('[0:01:01] Aria (Alice): Hi');
  });
});

describe('chunkLines', () => {
  const lines = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee'];

  it('keeps everything in order, within budget', () => {
    const chunks = chunkLines(lines, 10);
    expect(chunks.join('\n').split('\n')).toEqual(lines);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(10);
  });

  it('repeats overlap lines at the start of the next chunk', () => {
    const chunks = chunkLines(lines, 10, 1);
    expect(chunks.length).toBeGreaterThan(1);
    const firstLast = chunks[0]?.split('\n').at(-1);
    expect(chunks[1]?.split('\n')[0]).toBe(firstLast);
  });

  it('puts an oversize line in a chunk of its own and rejects a bad budget', () => {
    expect(chunkLines(['x'.repeat(50), 'y'], 10)).toEqual(['x'.repeat(50), 'y']);
    expect(() => chunkLines(lines, 0)).toThrow();
  });

  it('returns nothing for no lines', () => {
    expect(chunkLines([], 100)).toEqual([]);
  });
});

describe('groupByBudget', () => {
  it('packs whole notes and lets an oversize one stand alone', () => {
    expect(groupByBudget(['aa', 'bb', 'cc'], 4)).toEqual([['aa', 'bb'], ['cc']]);
    expect(groupByBudget(['x'.repeat(10), 'y'], 4)).toEqual([['x'.repeat(10)], ['y']]);
    expect(groupByBudget([], 4)).toEqual([]);
  });
});

describe('prompts', () => {
  it('requires a character name for character summaries', () => {
    expect(() => buildStoryPrompt('character', ['notes'], {})).toThrow(/characterName/);
    expect(buildStoryPrompt('character', ['notes'], { characterName: 'Aria' })).toContain(
      'as the story of "Aria"',
    );
  });

  it('asks the scribe for the record and the bard for the tale', () => {
    const scribe = buildNotesPrompt('[0:01] Aria: I open the door', 0, 1, { gameMaster: 'Morgan' });
    expect(scribe).toMatch(/one event per line/);
    expect(scribe).toMatch(/fumbles/);
    expect(scribe).toContain('"Morgan" is the Game Master');
    expect(scribe).toContain('[0:01] Aria: I open the door');
    expect(scribe).not.toMatch(/bard/);

    const bard = buildStoryPrompt('session', ['Aria opened the door.'], {
      campaignName: 'The Sunken Temple',
      gameMaster: 'Morgan',
    });
    expect(bard).toMatch(/humiliating fumbles/);
    expect(bard).toMatch(/Dry wit and gallows humour/);
    expect(bard).toMatch(/may not change WHAT happened/);
    expect(bard).toMatch(/at most 30 words/); // four words of notes: the limit follows the notes, not the cap
    expect(bard).toContain('campaign "The Sunken Temple"');
    expect(bard).toContain('Aria opened the door.');
    expect(bard).not.toContain('--- part'); // one block of notes is shown as it is
    expect(buildStoryPrompt('session', ['a', 'b'], {})).toContain('--- part 2 ---');
  });

  it('never lets a tale run longer than the notes it retells', () => {
    const notes = (words: number): string[] => [
      Array.from({ length: words }, () => 'word').join(' '),
    ];
    expect(taleWords(350, notes(60))).toBe(50);
    expect(taleWords(350, notes(300))).toBe(240);
    expect(taleWords(350, notes(2000))).toBe(350);
    expect(taleWords(200, notes(2000))).toBe(200);
    expect(taleWords(350, notes(3))).toBe(30);
    expect(buildStoryPrompt('session', notes(2000), {})).toMatch(/at most 350 words/);
  });

  it('keeps the Game Master brief plain', () => {
    const brief = buildBriefPrompt(['Aria opened the door.'], {});
    expect(brief).toMatch(/for the Game Master only/);
    expect(brief).toMatch(/no story-telling/);
    expect(brief).not.toMatch(/bard/);
  });
});

function manyLines(count: number): Utterance[] {
  return Array.from({ length: count }, (_, i) => ({
    speaker: i % 2 === 0 ? alice : bob,
    startMs: i * 10_000,
    endMs: i * 10_000 + 5_000,
    text: `line number ${i} with some padding words to take up room`,
  }));
}

describe('summarise', () => {
  it('takes notes, then tells the tale from them: two calls when the transcript fits', async () => {
    const generate = vi.fn(async () => '  The party went to the cellar.  ');
    const result = await summarise(generate, manyLines(3), { kind: 'session' });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('The party went to the cellar.');
    expect(result.modelCalls).toBe(2);
    expect(result.dmOnly).toBe(false);
  });

  it('gives the transcript to the scribe and only the notes to the bard', async () => {
    const scribe = vi.fn(async (_prompt: string) => 'Alice found a key.');
    const bard = vi.fn(async (_prompt: string) => 'A key! Glory.');
    const result = await summarise({ scribe, bard }, manyLines(3), { kind: 'session' });
    expect(result.text).toBe('A key! Glory.');
    expect(scribe.mock.calls[0]?.[0]).toContain('line number 0');
    expect(bard.mock.calls[0]?.[0]).toContain('Alice found a key.');
    expect(bard.mock.calls[0]?.[0]).not.toContain('line number 0');
  });

  it('drops a "Next time:" line the bard left empty, and keeps one that says something', () => {
    expect(tidyTale('They won.\n\nNext time:')).toBe('They won.');
    expect(tidyTale('They won.\n\n**Next time:**  ')).toBe('They won.');
    expect(tidyTale('They won.\n\nNext time: the door.')).toBe('They won.\n\nNext time: the door.');
  });

  it('has the scribe, not the bard, write the Game Master brief', async () => {
    const scribe = vi.fn(async () => 'plain');
    const bard = vi.fn(async () => 'ornate');
    const result = await summarise({ scribe, bard }, manyLines(3), { kind: 'dm-only' });
    expect(result.text).toBe('plain');
    expect(bard).not.toHaveBeenCalled();
  });

  it('writes any number of summaries from notes taken once', async () => {
    const scribe = vi.fn(async () => 'notes');
    const bard = vi.fn(async () => 'tale');
    const taken = await takeNotes(scribe, manyLines(40), { chunkChars: 600, overlapLines: 1 });
    expect(taken.notes.length).toBeGreaterThan(1);
    expect(taken.modelCalls).toBe(taken.notes.length);
    const readings = scribe.mock.calls.length;
    await writeFromNotes({ scribe, bard }, taken.notes, { kind: 'session' });
    await writeFromNotes({ scribe, bard }, taken.notes, {
      kind: 'character',
      context: { characterName: 'Aria' },
    });
    expect(scribe.mock.calls.length).toBe(readings); // the transcript was not read again
    expect(bard).toHaveBeenCalledTimes(2);
  });

  it('map-reduces a long transcript: one call per chunk plus a final combine', async () => {
    const prompts: string[] = [];
    const generate = async (prompt: string): Promise<string> => {
      prompts.push(prompt);
      return 'short note';
    };
    const result = await summarise(generate, manyLines(40), {
      kind: 'session',
      chunkChars: 600,
      overlapLines: 1,
    });
    expect(result.modelCalls).toBeGreaterThan(2);
    expect(prompts[0]).toContain('part 1 of');
    expect(prompts.at(-1)).toContain('The tale:');
  });

  it('keeps combining when the notes themselves are too long, then stops', async () => {
    let calls = 0;
    const generate = async (): Promise<string> => {
      calls += 1;
      return 'n'.repeat(400);
    };
    const result = await summarise(generate, manyLines(60), {
      kind: 'session',
      chunkChars: 500,
    });
    // Bounded: the depth cap prevents an endless loop even with a model that never shortens.
    expect(result.modelCalls).toBe(calls);
    expect(calls).toBeLessThan(500);
  });

  it('flags DM-only summaries so the API can restrict them', async () => {
    const result = await summarise(async () => 'secrets', manyLines(2), { kind: 'dm-only' });
    expect(result.dmOnly).toBe(true);
  });

  it('refuses an empty transcript instead of summarising nothing', async () => {
    await expect(summarise(async () => 'x', [], { kind: 'session' })).rejects.toThrow(/empty/);
  });
});

describe('createOllamaGenerate', () => {
  it('posts to /api/generate and returns the response text', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ response: 'hello' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const generate = createOllamaGenerate({
      model: 'm',
      baseUrl: 'http://ollama:11434/',
      numCtx: 8192,
      fetchImpl,
    });
    expect(await generate('prompt')).toBe('hello');

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://ollama:11434/api/generate');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'm',
      prompt: 'prompt',
      stream: false,
      think: false,
      options: { num_ctx: 8192 },
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty('keep_alive');
  });

  it('asks Ollama to unload the model after keepAlive when one is given', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ response: 'ok' }), { status: 200 }),
    ) as unknown as typeof fetch;
    await createOllamaGenerate({ model: 'm', keepAlive: '2m', fetchImpl })('p');
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({ keep_alive: '2m' });
  });

  it('fails clearly on HTTP errors and malformed bodies', async () => {
    const bad = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(createOllamaGenerate({ model: 'm', fetchImpl: bad })('p')).rejects.toThrow(/500/);
    const empty = (async () =>
      new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
    await expect(createOllamaGenerate({ model: 'm', fetchImpl: empty })('p')).rejects.toThrow(
      /response/,
    );
  });
});
