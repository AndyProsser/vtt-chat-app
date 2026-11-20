import { DEFAULT_AI_SETTINGS, setAiSetting } from '@vtt-chat-app/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Job, Recording, RecordingTrack, Segment } from '../../types/index.js';
import { MemoryJobQueue } from '../jobs/queue.js';
import { buildJobProviders } from '../providers/fromSettings.js';
import { processNext } from '../jobs/worker.js';
import { MemoryRecordsStore } from './memoryRecordsStore.js';
import { createProcessRecordingHandler, PROCESS_RECORDING_JOB } from './processRecording.js';

const REC = 'rec-1';
const recording: Recording = {
  id: REC,
  campaignId: 'camp-1',
  startedAt: 0,
  stoppedAt: 10,
  status: 'stopped',
};
const track = (
  id: string,
  speaker: string,
  extra: Partial<RecordingTrack> = {},
): RecordingTrack => ({
  id,
  recordingId: REC,
  speakerId: speaker,
  speakerName: speaker.toUpperCase(),
  filePath: `/audio/${id}.ogg`,
  startOffsetMs: 0,
  private: false,
  transcribedAt: null,
  ...extra,
});

let records: MemoryRecordsStore;
let transcribed: string[];
let prompts: string[];
const say = (text: string, startMs = 0): Segment[] => [{ startMs, endMs: startMs + 1000, text }];

function handler(overrides: Partial<Parameters<typeof createProcessRecordingHandler>[0]> = {}) {
  return createProcessRecordingHandler({
    records,
    localTranscribe: () => async () => [],
    localGenerate: async (prompt) => {
      prompts.push(prompt);
      if (prompt.startsWith('You keep the campaign memory')) return 'NONE';
      // The scribe lays its notes out under headings (Stage 12 D); the other roles answer in plain text.
      return prompt.startsWith('You are the scribe')
        ? `## Events\n- summary #${prompts.length}`
        : `summary #${prompts.length}`;
    },
    transcribeAudioFile: async (file) => {
      transcribed.push(file);
      return say(`said in ${file}`);
    },
    now: () => 5000,
    ...overrides,
  });
}
const job = (): Job => ({
  id: 'j',
  kind: PROCESS_RECORDING_JOB,
  recordingId: REC,
  state: 'running',
  attempts: 1,
  maxAttempts: 5,
  runAfter: 0,
  lockedUntil: null,
  lastError: null,
  createdAt: 0,
  updatedAt: 0,
});

beforeEach(async () => {
  records = new MemoryRecordsStore();
  transcribed = [];
  prompts = [];
  records.campaigns.set('camp-1', 'Curse of Strahd');
  await records.putRecording({ ...recording });
  await records.putTrack(track('t-alice', 'alice'));
  await records.putTrack(track('t-bob', 'bob', { startOffsetMs: 2000 }));
});

describe('process-recording handler', () => {
  it('transcribes every track, writes both summaries and marks the recording processed', async () => {
    await handler().run(job());
    expect(transcribed.sort()).toEqual(['/audio/t-alice.ogg', '/audio/t-bob.ogg']);
    expect((await records.getRecording(REC))?.status).toBe('processed');
    expect(await records.getSummary(REC, 'session', '')).toMatchObject({ visibility: 'members' });
    expect(await records.getSummary(REC, 'dm-only', '')).toMatchObject({ visibility: 'dm' });
  });

  it('writes a chapter summary for each part around a pause, and one per player character', async () => {
    records.players.set('camp-1', ['bob']); // alice is the DM
    for (const [at, event] of [
      [0, 'started'],
      [1000, 'paused'],
      [1500, 'resumed'],
      [9000, 'stopped'],
    ] as const) {
      await records.addRecordingEvent({ recordingId: REC, at, event });
    }
    await handler().run(job()); // alice speaks at 0 (part 1), bob at 2000 (part 2)
    const all = [...records.summaries.values()].map(
      (s) => `${s.kind}:${s.subject}:${s.visibility}`,
    );
    expect(all.sort()).toEqual(
      [
        'chapter:1:members',
        'chapter:2:members',
        'character:BOB:members',
        'dm-only::dm',
        'notes::dm',
        'session::members',
      ].sort(),
    );
    // The Game Master's copy of the notes: a heading per part, the scribe's headings under it, a bullet per event.
    expect((await records.getSummary(REC, 'notes', ''))?.text).toBe(
      '### Part 1\n\n#### Events\n- summary #1\n\n### Part 2\n\n#### Events\n- summary #2',
    );
    // The scribe reads each part once (two readings for five summaries); everything else is written from its notes.
    const readings = prompts.filter((p) => p.startsWith('You are the scribe'));
    expect(readings).toHaveLength(2);
    expect(readings[1]).toContain('said in /audio/t-bob.ogg');
    expect(readings[1]).not.toContain('said in /audio/t-alice.ogg');
    expect(prompts.filter((p) => p.includes('said in /audio/'))).toHaveLength(2);
    const chapter2 = prompts.find((p) => p.includes('part 2 of 2 of this session'));
    expect(chapter2).toMatch(/^You are the bard/);
    expect(chapter2).toContain('summary #2'); // the notes the scribe took of part 2
    expect(chapter2).not.toContain('summary #1');
    // The session's tale is told from both parts' notes, in order.
    const session = prompts.find((p) =>
      p.includes('Tell the tale of this session of the campaign'),
    );
    expect(session?.indexOf('summary #1')).toBeLessThan(session?.indexOf('summary #2') ?? 0);
    expect(prompts.find((p) => p.includes('as the story of "BOB"'))).toBeDefined();
    expect(prompts.find((p) => p.includes('for the Game Master only'))).toBeDefined();
    // The model is told whose lines are the Game Master's narration.
    expect(prompts[0]).toContain('"ALICE" is the Game Master');
  });

  it('weaves scene, effect, voice and group cues into what the model reads, and titles the scene chapter', async () => {
    await records.putTrack(
      track('t-long', 'carol', {
        // 70 s of speech after the scene starts, enough to open a chapter of its own
        startOffsetMs: 0,
      }),
    );
    const detail = (d: Record<string, unknown>) => d;
    await records.addRecordingEvent({ recordingId: REC, at: 0, event: 'started' });
    await records.addRecordingEvent({
      recordingId: REC,
      at: 120_000,
      event: 'scene',
      detail: detail({ action: 'start', name: 'Drowned Crypt', ambience: ['Eerie hum'] }),
    });
    await records.addRecordingEvent({
      recordingId: REC,
      at: 125_000,
      event: 'voice',
      detail: detail({ voice: 'dragon', by: 'ALICE' }),
    });
    await handler({
      transcribeAudioFile: async (file) =>
        file.includes('t-long')
          ? [{ startMs: 121_000, endMs: 191_000, text: 'we descend the stairs' }]
          : say(`said in ${file}`),
    }).run(job());
    expect(prompts.find((p) => p.includes('part 2 of 2 of this session'))).toContain(
      'which began in the scene "Drowned Crypt"',
    );
    const [part1, chapter] = prompts.filter((p) => p.startsWith('You are the scribe'));
    expect(chapter).toContain('(cue) Scene started: "Drowned Crypt" (sounds: Eerie hum)');
    expect(chapter).toContain('(cue) ALICE switched to the character voice "dragon"');
    expect(chapter).toContain('not events');
    expect(part1).not.toContain('Drowned Crypt"');
    // Cues sit among the lines in time order.
    expect(chapter?.indexOf('Scene started')).toBeLessThan(chapter?.indexOf('we descend') ?? 0);
  });

  it('puts the speakers and their track offsets into what the model reads', async () => {
    await handler().run(job());
    expect(prompts[0]).toContain('ALICE');
    expect(prompts[0]).toContain('BOB');
    expect(prompts[0]).toContain('Curse of Strahd');
  });

  it('includes the chat typed during the recording, marked as typed, and never a whisper', async () => {
    await records.addRecordingEvent({
      recordingId: REC,
      at: 1500,
      event: 'chat',
      detail: { senderId: 'carol', senderName: 'CAROL', text: 'the key is under the mat' },
    });
    await records.addRecordingEvent({
      recordingId: REC,
      at: 1600,
      event: 'chat',
      detail: { senderId: 'dan', senderName: 'DAN', text: 'psst-whisper-xyz', to: 'alice' },
    });
    await handler().run(job());
    expect(prompts[0]).toContain('CAROL (typed): the key is under the mat');
    expect(prompts.join('\n')).not.toContain('psst-whisper-xyz');
  });

  it('summarises a session that was only typed, rather than calling it silent', async () => {
    const typedOnly = handler({ transcribeAudioFile: async () => [] });
    await records.addRecordingEvent({
      recordingId: REC,
      at: 100,
      event: 'chat',
      detail: { senderId: 'carol', senderName: 'CAROL', text: 'we met in the market' },
    });
    await typedOnly.run(job());
    expect(prompts.length).toBeGreaterThan(0);
    expect((await records.getSummary(REC, 'session', ''))?.text).not.toMatch(/No speech/);
  });

  it('NEVER transcribes or summarises a private track', async () => {
    await records.putTrack(track('t-whisper', 'carol', { private: true }));
    await handler().run(job());
    expect(transcribed).not.toContain('/audio/t-whisper.ogg');
    expect(prompts.join('\n')).not.toContain('CAROL');
    expect((await records.listTranscripts(REC)).map((t) => t.speaker.id)).not.toContain('carol');
    await expect(records.saveTrackTranscript('t-whisper', say('x'), 1)).rejects.toThrow(/private/);
  });

  it('resumes after a failure without redoing finished work', async () => {
    let calls = 0;
    const flaky = handler({
      transcribeAudioFile: async (file) => {
        transcribed.push(file);
        if (++calls === 2) throw new Error('whisper box fell over');
        return say('ok');
      },
    });
    await expect(flaky.run(job())).rejects.toThrow('fell over');
    expect(transcribed).toHaveLength(2);

    transcribed = [];
    await handler().run(job());
    expect(transcribed).toHaveLength(1); // only the track that had not finished
    expect((await records.getRecording(REC))?.status).toBe('processed');
  });

  it('tells the table when the summary is ready', async () => {
    await handler().run(job());
    expect(records.notified).toEqual([REC]);
  });

  it('does not rewrite a summary that already exists', async () => {
    await handler().run(job());
    const calls = prompts.length;
    await handler().run(job());
    expect(prompts).toHaveLength(calls);
  });

  it('records "no speech" without asking a model to invent a summary', async () => {
    const silent = handler({ transcribeAudioFile: async () => [] });
    await silent.run(job());
    expect(prompts).toHaveLength(0);
    expect((await records.getSummary(REC, 'session', ''))?.text).toMatch(/No speech/);
    expect((await records.getRecording(REC))?.status).toBe('processed');
  });

  it('uses the remote backend named in the settings and falls back to local when it is down', async () => {
    records.aiSettings = setAiSetting(
      setAiSetting(
        setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.kind', 'remote'),
        'ai.llm.url',
        'http://gpu:11434',
      ),
      'ai.fallback.after-seconds',
      '0',
    );
    const log: string[] = [];
    const h = handler({
      log: (l) => log.push(l),
      // the real builder, with a fetch that always refuses, as a powered-off gaming PC would
      buildProviders: (settings, d) =>
        buildJobProviders(settings, {
          ...d,
          fetchImpl: (async () => {
            throw new TypeError('fetch failed');
          }) as unknown as typeof fetch,
        }),
    });
    await h.run(job());
    expect((await records.getSummary(REC, 'session', ''))?.text).toMatch(/^summary #/);
    expect(log.join('\n')).toContain('fell back to local');
  });

  it('fails clearly for a recording that does not exist', async () => {
    await expect(handler().run({ ...job(), recordingId: 'nope' })).rejects.toThrow(
      /does not exist/,
    );
  });

  it('marks the recording failed when the job gives up', async () => {
    await handler().onGiveUp?.(job(), 'x');
    expect((await records.getRecording(REC))?.status).toBe('failed');
  });
});

describe('through the queue', () => {
  it('a job that fails then succeeds ends processed, with the worker doing the retrying', async () => {
    const queue = new MemoryJobQueue();
    await queue.enqueue({ kind: PROCESS_RECORDING_JOB, recordingId: REC }, 0);
    let fail = true;
    const handlers = {
      [PROCESS_RECORDING_JOB]: handler({
        transcribeAudioFile: async (f) => {
          if (fail) throw new Error('transient');
          return say(f);
        },
      }),
    };
    let t = 1000;
    await processNext({ queue, handlers, now: () => t });
    expect((await queue.list())[0]).toMatchObject({ state: 'queued', attempts: 1 });
    fail = false;
    t += 60_000;
    await processNext({ queue, handlers, now: () => t });
    expect((await queue.list())[0]?.state).toBe('done');
    expect((await records.getRecording(REC))?.status).toBe('processed');
  });
});

describe('the campaign vocabulary (Stage 12 B and C)', () => {
  const names = [{ term: 'Ravenshade', aliases: ['raven shade'], rank: 0 }];
  const heard = async (): Promise<Segment[]> => say('We met raven shade at dawn.');

  async function run(glossary: string) {
    records.vocabulary.set('camp-1', names);
    records.aiSettings = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.transcription.glossary', glossary);
    let prompt: string | undefined = 'untouched';
    await handler({
      transcribeAudioFile: heard,
      buildProviders: (settings, deps) => {
        prompt = deps.transcriptionPrompt;
        return buildJobProviders(settings, deps);
      },
    }).run(job());
    const [first] = await records.listTranscripts(REC);
    return { prompt, text: first?.segments[0]?.text };
  }

  it('corrects by default and sends no prompt', async () => {
    expect(await run('corrections')).toEqual({
      prompt: undefined,
      text: 'We met Ravenshade at dawn.',
    });
  });

  it('with prompt only, sends the names and leaves the text as heard', async () => {
    expect(await run('prompt')).toEqual({
      prompt: 'Names in this game: Ravenshade.',
      text: 'We met raven shade at dawn.',
    });
  });

  it('with both, does both', async () => {
    expect(await run('both')).toEqual({
      prompt: 'Names in this game: Ravenshade.',
      text: 'We met Ravenshade at dawn.',
    });
  });

  it('with off, does neither', async () => {
    expect(await run('off')).toEqual({ prompt: undefined, text: 'We met raven shade at dawn.' });
  });
});

describe('the storyteller and the Game Master’s notes (Stage 12 E and G)', () => {
  const secret = 'The cult serves Vecna.';
  async function run(bard: 'tavern' | 'drunken' | 'sarcastic', off: string[] = []) {
    records.bards.set('camp-1', bard);
    records.notesOf.set('camp-1', secret);
    let settings = DEFAULT_AI_SETTINGS;
    for (const id of off) settings = setAiSetting(settings, `ai.storyteller.${id}` as never, 'off');
    records.aiSettings = settings;
    await handler().run(job());
    const by = (needle: string) => prompts.filter((p) => p.includes(needle));
    return {
      scribe: by('You are the scribe').join('\n'),
      tale: by('You are the bard').join('\n'),
      brief: by('You are the Chronicler').join('\n'),
    };
  }

  it('tells the tale in the campaign’s voice', async () => {
    const out = await run('sarcastic');
    expect(out.tale).toContain('the Wry Jester');
    expect(out.tale).not.toContain('the Tavern Bard');
  });

  it('falls back to the Tavern Bard when the operator has turned the storyteller off', async () => {
    const out = await run('sarcastic', ['sarcastic']);
    expect(out.tale).toContain('the Tavern Bard');
    expect(out.tale).not.toContain('the Wry Jester');
  });

  it('gives the Game Master’s notes to the Chronicler only, for every storyteller but the drunkard', async () => {
    const out = await run('tavern');
    expect(out.brief).toContain('Vecna');
    expect(out.tale).not.toContain('Vecna');
    expect(out.scribe).not.toContain('Vecna');
  });

  it('lets the Tipsy Minstrel read them, and still never the scribe', async () => {
    const out = await run('drunken');
    expect(out.tale).toContain('the Tipsy Minstrel');
    expect(out.tale).toContain('Vecna');
    expect(out.brief).toContain('Vecna');
    expect(out.scribe).not.toContain('Vecna');
  });

  it('passes the operator’s limits to the tale', async () => {
    records.aiSettings = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.tale.content', 'clean');
    await handler().run(job());
    expect(prompts.filter((p) => p.includes('You are the bard')).join('\n')).toMatch(
      /language clean/,
    );
  });
});

describe('campaign memory (Stage 12 F)', () => {
  const gary = {
    id: 'm-gary',
    kind: 'npc' as const,
    name: 'Gary the Grumpy Gnome',
    aliases: ['Gary'],
    gist: 'Sells lanterns in Dunmere and owes the party a favour.',
    firstRecordingId: 'rec-0',
    firstSeen: 1,
    lastSeen: 1,
    timesSeen: 1,
  };

  /** A scribe that says the party met Gary, and a memory step that answers `memoryAnswer`. */
  function handlerWith(memoryAnswer: string) {
    return handler({
      localGenerate: async (prompt) => {
        prompts.push(prompt);
        if (prompt.startsWith('You keep the campaign memory')) return memoryAnswer;
        return prompt.startsWith('You are the scribe')
          ? '## Events\n- The party found Gary again and bought a lantern.'
          : 'told';
      },
    });
  }

  it('hands the tale and the brief what earlier sessions learned, and never the scribe', async () => {
    records.memory.set('camp-1', [gary]);
    await handlerWith('NONE').run(job());
    const tale = prompts.find((p) => p.includes('You are the bard'));
    expect(tale).toContain('Gary the Grumpy Gnome (person; also Gary): Sells lanterns');
    expect(prompts.find((p) => p.includes('You are the Chronicler'))).toContain('Gary the Grumpy');
    expect(prompts.find((p) => p.startsWith('You are the scribe'))).not.toContain(
      'Gary the Grumpy',
    );
  });

  it('does not show a session the entries it taught itself', async () => {
    records.memory.set('camp-1', [{ ...gary, firstRecordingId: REC }]);
    await handlerWith('NONE').run(job());
    expect(prompts.find((p) => p.includes('You are the bard'))).not.toContain(
      'From earlier sessions',
    );
  });

  it('learns from the session: a new entry, and Gary met again', async () => {
    records.memory.set('camp-1', [gary]);
    await handlerWith(
      'npc | Gary the Grumpy Gnome | Gary | Sold the party a lantern; still owes a favour.\nlocation | Dunmere | none | A market town where Gary has his stall.',
    ).run(job());
    const kept = await records.listMemory('camp-1');
    const g = kept.find((e) => e.id === 'm-gary');
    expect(g?.timesSeen).toBe(2);
    expect(g?.gist).toMatch(/lantern/);
    expect(kept.find((e) => e.name === 'Dunmere')?.firstRecordingId).toBe(REC);
    expect(await records.memoryApplied(REC)).toBe(true);
  });

  it('counts a session once, however often the job runs', async () => {
    await handlerWith('npc | Pim | none | A halfling with a lantern.').run(job());
    await handlerWith('npc | Pim | none | A halfling with a lantern.').run(job());
    expect((await records.listMemory('camp-1'))[0]?.timesSeen).toBe(1);
  });

  it('never fails the job when the memory step cannot be done', async () => {
    await handlerWith('I could not do that.').run(job());
    expect((await records.getRecording(REC))?.status).toBe('processed');
    expect(await records.memoryApplied(REC)).toBe(false); // so a later run tries again
  });

  it('does nothing when the operator has turned it off', async () => {
    records.memory.set('camp-1', [gary]);
    records.aiSettings = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.memory.enabled', 'false');
    await handlerWith('npc | Pim | none | Someone.').run(job());
    expect(prompts.some((p) => p.startsWith('You keep the campaign memory'))).toBe(false);
    expect(prompts.find((p) => p.includes('You are the bard'))).not.toContain(
      'From earlier sessions',
    );
  });
});
