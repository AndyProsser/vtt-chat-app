import { describe, expect, it, vi } from 'vitest';

import type { TrackTranscript, Utterance } from '../types/index.js';
import { chunkLines } from './chunk.js';
import { formatTimestamp, formatUtterance } from './format.js';
import { mergeTranscripts } from './merge.js';
import { createOllamaGenerate } from './ollama.js';
import { buildChunkPrompt } from './prompts.js';
import { groupByBudget, stripThinking, summarise } from './summarise.js';
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
    expect(() => buildChunkPrompt('character', 'text', 0, 1, {})).toThrow(/characterName/);
    expect(buildChunkPrompt('character', 'text', 0, 2, { characterName: 'Aria' })).toContain(
      'Aria',
    );
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
  it('uses a single call when the transcript fits', async () => {
    const generate = vi.fn(async () => '  The party went to the cellar.  ');
    const result = await summarise(generate, manyLines(3), { kind: 'session' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('The party went to the cellar.');
    expect(result.modelCalls).toBe(1);
    expect(result.dmOnly).toBe(false);
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
    expect(prompts.at(-1)).toContain('Summary:');
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
