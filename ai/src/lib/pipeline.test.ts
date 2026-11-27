import { describe, expect, it, vi } from 'vitest';

import type { TrackTranscript, Utterance } from '../types/index.js';
import { chunkLines } from './chunk.js';
import { formatTimestamp, formatUtterance } from './format.js';
import { mergeTranscripts } from './merge.js';
import { BARD_IDS } from '@vtt-chat-app/shared';
import { BARD_SAMPLING } from '../consts/index.js';
import { createOllamaGenerate } from './ollama.js';
import {
  buildChroniclerPrompt,
  GM_NOTES_PROMPT_CHARS,
  CHRONICLER_HEADINGS,
  buildNotesPrompt,
  buildStoryPrompt,
  formatNotes,
  parseStoredNotes,
  taleWords,
} from './prompts.js';
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

/** A scribe's answer laid out as the notes prompt asks; every other role answers `other`. */
const notesOr =
  (other: string, noted = 'noted') =>
  async (prompt: string): Promise<string> =>
    prompt.startsWith('You are the scribe') ? `## Events\n- ${noted}` : other;

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
    const generate = async (p: string) =>
      p.startsWith('You are the scribe')
        ? '<think>secret reasoning</think>## Events\n- They fought.'
        : '<think>secret reasoning</think>The party won.';
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
    expect(scribe).toMatch(/one bullet per thing/);
    expect(scribe).toContain('## Memorable quotes');
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
    expect(bard).toMatch(/Keep close to the facts/);
    expect(bard).toMatch(/at most 30 words/i); // four words of notes: the limit follows the notes, not the cap
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
    expect(buildStoryPrompt('session', notes(2000), {})).toMatch(/at most 350 words/i); // the default ceiling
  });

  it('tells the bard that not everyone belongs in the tale', () => {
    expect(buildStoryPrompt('session', ['Aria opened the door.'], {})).toMatch(
      /may be left out or pass in a clause/,
    );
  });

  it('lets every storyteller set foreign speech as a language span, sparingly and only when a language is named', () => {
    for (const storyteller of BARD_IDS) {
      const prompt = buildStoryPrompt('session', ['Aria spoke Elvish to the guard.'], {
        storyteller,
      });
      expect(prompt, storyteller).toContain('[the words](lang:<language>)');
      expect(prompt, storyteller).toMatch(/only when the notes name the language/);
    }
  });

  it('does not offer language spans to the notes-taking scribe or the Chronicler', () => {
    expect(buildNotesPrompt('A line.', 1, 1, {})).not.toContain('lang:');
    expect(buildChroniclerPrompt(['Aria opened the door.'], {})).not.toContain('lang:');
  });

  it('shows the scribe’s notes as one bullet per event, with a heading per part', () => {
    expect(
      formatNotes([{ notes: ['Aria opened the door.\n\n- Bram fell in.', '2. The eel fled.'] }]),
    ).toBe('- Aria opened the door.\n- Bram fell in.\n- The eel fled.');
    expect(
      formatNotes([
        { title: 'Part 1: Crypt', notes: ['* A.'] },
        { title: 'Part 2', notes: ['B.'] },
      ]),
    ).toBe('### Part 1: Crypt\n\n- A.\n\n### Part 2\n\n- B.');
  });

  it('keeps the scribe’s headings, one level below a part', () => {
    expect(
      formatNotes([{ title: 'Part 1', notes: ['## Events\n- A.\n## Memorable quotes\n- "B."'] }]),
    ).toBe('### Part 1\n\n#### Events\n- A.\n#### Memorable quotes\n- "B."');
  });

  it('has the Chronicler write the Game Master a short brief under fixed headings', () => {
    const brief = buildChroniclerPrompt(['Aria opened the door.'], {});
    expect(brief).toMatch(/You are the Chronicler/);
    expect(brief).toMatch(/for the Game Master only/);
    expect(brief).toMatch(/150 to 250 words/);
    expect(brief).toMatch(/No story-telling/);
    expect(brief).not.toMatch(/bard/);
    for (const heading of CHRONICLER_HEADINGS) expect(brief).toContain(`## ${heading}`);
    expect(brief).not.toMatch(/own notes/); // none given, none mentioned
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
    const generate = vi.fn(notesOr('  The party went to the cellar.  '));
    const result = await summarise(generate, manyLines(3), { kind: 'session' });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('The party went to the cellar.');
    expect(result.modelCalls).toBe(2);
    expect(result.dmOnly).toBe(false);
  });

  it('gives the transcript to the scribe and only the notes to the bard', async () => {
    const scribe = vi.fn(async (_prompt: string) => '## Events\n- Alice found a key.');
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
    const scribe = vi.fn(notesOr('plain'));
    const bard = vi.fn(async () => 'ornate');
    const result = await summarise({ scribe, bard }, manyLines(3), { kind: 'dm-only' });
    expect(result.text).toBe('plain');
    expect(bard).not.toHaveBeenCalled();
  });

  it('writes any number of summaries from notes taken once', async () => {
    const scribe = vi.fn(notesOr('notes'));
    const bard = vi.fn(async () => 'tale');
    const taken = await takeNotes(scribe, manyLines(40), { chunkChars: 600, overlapLines: 1 });
    expect(taken.notes).toHaveLength(1); // the pieces are one set of notes
    expect(taken.modelCalls).toBeGreaterThan(1); // read piece by piece
    const readings = scribe.mock.calls.length;
    await writeFromNotes({ scribe, bard }, taken.notes, { kind: 'session' });
    await writeFromNotes({ scribe, bard }, taken.notes, {
      kind: 'character',
      context: { characterName: 'Aria' },
    });
    expect(scribe.mock.calls.length).toBe(readings); // the transcript was not read again
    expect(bard).toHaveBeenCalledTimes(2);
  });

  it('condenses even a single oversized note, not only many joined notes', async () => {
    // 25,000 characters ≈ 7,143 estimated tokens, comfortably over 70% of the 8,192-token default
    // window (5,734). A dm-only write always makes one final scribe call for the brief itself, so
    // condensing shows up as *more than one* call, not merely "called" (the brief call alone would
    // already satisfy a plain "was it called" check).
    const bigNote = 'word '.repeat(5000);
    const condense = vi.fn(async () => 'word '.repeat(100));
    await writeFromNotes({ scribe: condense, bard: condense }, [bigNote], {
      kind: 'dm-only',
      context: {},
      llm: { kind: 'local', context: null } as never,
    });
    expect(condense.mock.calls.length).toBeGreaterThan(1);
  });

  it('uses a shared fitter when the job gives one, so the notes are not shortened again for each summary', async () => {
    const scribe = vi.fn(async () => 'brief');
    const bard = vi.fn(async (p: string) => p);
    const fit = vi.fn(async (notes: string[]) => ({
      notes: ['SHARED SHORT NOTES'],
      modelCalls: 3 + notes.length * 0,
    }));
    const big = ['word '.repeat(9000)];
    const a = await writeFromNotes({ scribe, bard }, big, { kind: 'session', context: {}, fit });
    const b = await writeFromNotes({ scribe, bard }, big, { kind: 'dm-only', context: {}, fit });
    expect(fit).toHaveBeenCalledTimes(2); // asked each time: the job's fitter is what remembers
    expect(a.text).toContain('SHARED SHORT NOTES');
    expect(b.modelCalls).toBe(3 + 1); // the fitter's calls plus the brief itself
    expect(scribe).toHaveBeenCalledTimes(1); // only the brief: no shortening of its own
  });

  it('does not condense when nothing is configured and the notes are small', async () => {
    const condense = vi.fn(async () => 'a short reply');
    await writeFromNotes({ scribe: condense, bard: condense }, ['a short note'], {
      kind: 'dm-only',
      context: {},
    });
    // Exactly the one required call to write the brief itself; no extra condense round.
    expect(condense.mock.calls.length).toBe(1);
  });

  it('map-reduces a long transcript: one call per chunk plus a final combine', async () => {
    const prompts: string[] = [];
    const generate = async (prompt: string): Promise<string> => {
      prompts.push(prompt);
      return notesOr('short note', 'short note')(prompt);
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
    const generate = async (p: string): Promise<string> => {
      calls += 1;
      return p.startsWith('You are the scribe')
        ? `## Events\n- ${'n'.repeat(400)}`
        : 'n'.repeat(400);
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
    const result = await summarise(notesOr('secrets'), manyLines(2), { kind: 'dm-only' });
    expect(result.dmOnly).toBe(true);
  });

  it('refuses an empty transcript instead of summarising nothing', async () => {
    await expect(summarise(async () => 'x', [], { kind: 'session' })).rejects.toThrow(/empty/);
  });

  it('retries a model-abort once on the same backend before giving up', async () => {
    let calls = 0;
    const scribe = async (prompt: string): Promise<string> => {
      calls += 1;
      if (calls === 1) throw new Error('prediction aborted, token repeat limit reached');
      return notesOr('notes')(prompt);
    };
    const result = await takeNotes(scribe, manyLines(3), {});
    expect(result.notes[0]).toContain('noted'); // notesOr's default scribe answer for a readable chunk
    expect(calls).toBe(2);
  });

  it('names the part and the reason when a model-abort recurs, instead of a generic failure', async () => {
    const scribe = async (): Promise<string> => {
      throw new Error('prediction aborted, token repeat limit reached');
    };
    await expect(takeNotes(scribe, manyLines(3), {})).rejects.toThrow(
      /part 1 of 1.*aborted generation/i,
    );
  });

  it('names the right part when the abort is on a later chunk, not always "part 1"', async () => {
    const scribe = async (prompt: string): Promise<string> => {
      if (prompt.includes('part 2 of')) {
        throw new Error('prediction aborted, token repeat limit reached');
      }
      return notesOr('notes')(prompt);
    };
    await expect(
      takeNotes(scribe, manyLines(40), { chunkChars: 600, overlapLines: 1 }),
    ).rejects.toThrow(/part 2 of \d+.*aborted generation/i);
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
      // The scribe's sampling by default, always sent: qwen3.5's own (presence_penalty 1.5) wrecks notes.
      options: { num_ctx: 8192, temperature: 0.2, presence_penalty: 0 },
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty('keep_alive');
  });

  it("samples as it is told (the bard's settings)", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ response: 'ok' }), { status: 200 }),
    ) as unknown as typeof fetch;
    await createOllamaGenerate({ model: 'm', sampling: BARD_SAMPLING, fetchImpl })('p');
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body)).options).toEqual({
      temperature: BARD_SAMPLING.temperature,
      presence_penalty: 0,
    });
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

  it('resolves a function numCtx fresh on every call, not once at construction', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ response: 'ok' }), { status: 200 }),
    ) as unknown as typeof fetch;
    let current = 32_000;
    const generate = createOllamaGenerate({
      model: 'm',
      numCtx: async () => current,
      fetchImpl,
    });
    await generate('p');
    current = 4096;
    await generate('p');
    const bodies = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      ([, init]: [string, RequestInit]) => JSON.parse(String(init.body)).options.num_ctx,
    );
    expect(bodies).toEqual([32_000, 4096]);
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

  it('keeps the real reason in the error, not just the status', async () => {
    const bad = (async () =>
      new Response(
        'model runner has unexpectedly stopped: prediction aborted, token repeat limit reached',
        { status: 500 },
      )) as unknown as typeof fetch;
    await expect(createOllamaGenerate({ model: 'm', fetchImpl: bad })('p')).rejects.toThrow(
      /repeat limit/,
    );
  });

  it('gives the fetch a signal, so a call that never resolves can be aborted', async () => {
    let seenSignal: AbortSignal | undefined;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seenSignal = init.signal as AbortSignal;
      return new Response(JSON.stringify({ response: 'ok' }), { status: 200 });
    }) as unknown as typeof fetch;
    await createOllamaGenerate({ model: 'm', fetchImpl })('p');
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it('aborts after its own timeoutMs, not the default, and says so plainly', async () => {
    const fetchImpl = (async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
        );
      })) as unknown as typeof fetch;
    await expect(
      createOllamaGenerate({ model: 'm', timeoutMs: 10, fetchImpl })('p'),
    ).rejects.toThrow(/exceeded its 0-minute timeout/);
  });
});

describe('the storytellers (Stage 12 G)', () => {
  const notes = ['Aria opened the door.'];
  const secret = 'The cult serves Vecna: Pim is a spy.';

  it('has a voice for each of the five', () => {
    const voices = (['tavern', 'dry', 'drunken', 'sarcastic', 'bored'] as const).map(
      (storyteller) => buildStoryPrompt('session', notes, { storyteller }),
    );
    expect(voices[0]).toContain('the Tavern Bard');
    expect(voices[1]).toContain('the Dry Historian');
    expect(voices[2]).toContain('the Tipsy Minstrel');
    expect(voices[3]).toContain('the Wry Jester');
    expect(voices[4]).toContain('the Bored Court Scribe');
    expect(new Set(voices).size).toBe(5);
    expect(buildStoryPrompt('session', notes, {})).toContain('the Tavern Bard'); // the default
  });

  it('keeps the facts, with a little invention allowed, for all but the Tipsy Minstrel', () => {
    for (const storyteller of ['tavern', 'dry', 'sarcastic', 'bored'] as const) {
      const prompt = buildStoryPrompt('session', notes, { storyteller });
      expect(prompt).toMatch(/Keep close to the facts/);
      expect(prompt).toMatch(/Nothing happens in the tale that the notes do not say/);
    }
    const drunk = buildStoryPrompt('session', notes, { storyteller: 'drunken' });
    expect(drunk).toMatch(/pure chaos with nods to the truth/);
    expect(drunk).not.toMatch(/Nothing happens in the tale that the notes do not say/);
  });

  it('gives the Game Master’s own notes to the Tipsy Minstrel and to no other storyteller', () => {
    for (const storyteller of ['tavern', 'dry', 'sarcastic', 'bored'] as const) {
      expect(buildStoryPrompt('session', notes, { storyteller, gmNotes: secret })).not.toContain(
        'Vecna',
      );
    }
    const drunk = buildStoryPrompt('session', notes, { storyteller: 'drunken', gmNotes: secret });
    expect(drunk).toContain('Vecna');
    expect(drunk).toMatch(/let a secret .* slip/);
    // And the scribe never sees them, whatever the context holds.
    expect(buildNotesPrompt('[0:01] Aria: hi', 0, 1, { gmNotes: secret } as never)).not.toContain(
      'Vecna',
    );
  });

  it('lets the operator set the ceiling on length and how graphic the telling is', () => {
    const words = Array.from({ length: 4000 }, () => 'word').join(' ');
    expect(buildStoryPrompt('session', [words], { taleLength: 'short' })).toMatch(
      /at most 250 words/i,
    );
    expect(buildStoryPrompt('session', [words], { taleLength: 'long' })).toMatch(
      /at most 500 words/i,
    );
    expect(buildStoryPrompt('character', [words], { characterName: 'Aria' })).toMatch(
      /at most 150 words/i,
    );
    expect(buildStoryPrompt('session', notes, { taleContent: 'clean' })).toMatch(/language clean/);
    expect(buildStoryPrompt('session', notes, { taleContent: 'graphic' })).toMatch(/told plainly/);
    expect(buildStoryPrompt('session', notes, {})).not.toMatch(/language clean|told plainly/);
  });

  it('gives the Chronicler the start of the Game Master’s notes, and only the start', () => {
    const long = `${secret} ${'x'.repeat(GM_NOTES_PROMPT_CHARS)}END`;
    const brief = buildChroniclerPrompt(notes, { gmNotes: long });
    expect(brief).toContain('Vecna');
    expect(brief).toMatch(/continuity warning where the session went against them/);
    expect(brief).not.toContain('END');
  });
});

describe('parseStoredNotes', () => {
  it('reads the stored notes of a chaptered session back, one block per chapter', () => {
    const stored = formatNotes([
      { title: 'Part 1: The Anchor', notes: ['## Events\n- They met.\n## Loot\n- A key.'] },
      { title: 'Part 2', notes: ['## Events\n- They sailed.'] },
    ]);
    const parts = parseStoredNotes(stored);
    expect([...parts.keys()]).toEqual(['1', '2']);
    expect(parts.get('1')).toEqual(['## Events\n- They met.\n## Loot\n- A key.']);
    expect(parts.get('2')).toEqual(['## Events\n- They sailed.']);
  });
  it('gives nothing for notes that are not in that layout, so the caller takes them again', () => {
    expect(parseStoredNotes('- one plain line\n- another').size).toBe(0);
    expect(parseStoredNotes('### Part 1\n\n').size).toBe(0);
    expect(parseStoredNotes('').size).toBe(0);
  });
});
